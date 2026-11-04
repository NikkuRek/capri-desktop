'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage, session,
} = require('electron');

app.commandLine.appendSwitch('remote-debugging-port', '9222');

const config = require('./config');

function applyRender() {
  const { render } = config.load();
  if (render === 'gl') app.commandLine.appendSwitch('use-angle', 'gl');
  if (render === 'software') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  }
}
applyRender();
const { TRAY, LANGS } = require('./labels');
const { startWindowWatch } = require('./windows');
const commands = require('./commands');
const launcher = require('./launcher');
const { loadEnv } = require('./env');
const ai = require('./ai');
const apps = require('./apps');
const system = require('./system');
const { createBridge } = require('./bridge');

const ROOT = path.resolve(__dirname, '..', '..');
loadEnv(ROOT);
const DEV = process.argv.includes('--dev');
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let tray = null;
let trayMenu = null;
let windowWatch = null;
let lastWindows = null;
let bridgeServer = null;

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');
const memoryFile = () => path.join(app.getPath('userData'), 'memory.json');
function readMemory() {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveMemory(patch) {
  try {
    fs.writeFileSync(memoryFile(), JSON.stringify({ ...readMemory(), ...patch }, null, 2));
  } catch (err) {
    console.error('[capri] no se pudo guardar memoria:', err.message);
  }
}

const snaps = new Map();
async function snapScreen() {
  try {
    const { execSync } = require('child_process');
    const b64 = execSync('grim -t jpeg - | base64', { timeout: 3500, maxBuffer: 12 * 1024 * 1024 })
      .toString('utf8').replace(/\s+/g, '');
    if (b64) return b64;
  } catch { }
  const { desktopCapturer } = require('electron');
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
  const src = sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('No se pudo capturar la pantalla');
  return src.thumbnail.toJPEG(75).toString('base64');
}

async function sayAboutSnap({ id, persona, prompt }) {
  const image = snaps.get(id);
  snaps.delete(id);
  if (!image) return { ok: false, error: 'La captura de pantalla expiró' };
  const cfg = config.load();
  if ((cfg.aiProvider || 'gemini') === 'gemini') {
    const apiKey = ai.gemini.getApiKey();
    if (!apiKey) return { ok: false, code: 'noai', error: 'Falta GEMINI_API_KEY en .env' };
    const model = ai.gemini.getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${persona || ''}\n\n${prompt || ''}` },
            { inlineData: { mimeType: 'image/jpeg', data: image } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 256,
        thinkingConfig: { thinkingBudget: 0 }
      }
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.error?.message || `HTTP ${res.status}`, model };
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { ok: true, text, model };
    } catch (err) {
      return { ok: false, error: err.message, model };
    }
  } else {
    return { ok: false, code: 'novision', model: 'Ollama Llama 3' };
  }
}

// capri://app/...        -> files of this repo
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function displays() {
  const real = screen.getAllDisplays();
  if (!DEV || process.env.CAPRI_SCREENS !== '2' || real.length > 1) return real;
  const d = screen.getPrimaryDisplay();
  const half = (r, i) => ({ x: r.x + Math.floor(r.width / 2) * i, y: r.y, width: Math.floor(r.width / 2), height: r.height });
  return [0, 1].map((i) => ({ ...d, id: d.id * 10 + i + 1, bounds: half(d.bounds, i), workArea: half(d.workArea, i), size: { width: Math.floor(d.size.width / 2), height: d.size.height } }));
}

function displayAt(p) {
  const all = displays();
  const inside = all.find(({ bounds: b }) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height);
  if (inside) return inside;
  const near = screen.getDisplayNearestPoint(p);
  return all.find((d) => d.id === near.id) || all[0];
}

function targetDisplay() {
  const { displayId } = config.load();
  const all = displays();
  return all.find((d) => d.id === displayId) || all.find((d) => d.id === screen.getPrimaryDisplay().id) || all[0];
}

let isOverlayExpanded = false;

function compactDimensions(scale = 0.6, expanded = false) {
  const s = typeof scale === 'number' && scale > 0 ? scale : 0.6;
  if (expanded) {
    const w = Math.round(Math.max(480, 360 + 160 * s));
    const h = Math.round(Math.max(440, 340 + 180 * s));
    return { width: w, height: h };
  }
  // Dimensiones que cubren la silueta completa de Capri (352x532 con padding) sin recortar
  const w = Math.round(352 * s + 24);
  const h = Math.round(532 * s + 24);
  return { width: w, height: h };
}

function targetBounds() {
  const td = targetDisplay();
  const { workArea, bounds } = td;
  const cfg = config.load();

  if (!cfg.visible) {
    // Modo chip ultra-compacto: apenas un pequeño icono en la esquina inferior izquierda
    const w = 76;
    const h = 96;
    return {
      x: workArea.x + 16,
      y: workArea.y + workArea.height - h - 16,
      width: w,
      height: h,
      gap: 0,
    };
  }

  if (cfg.compact) {
    const dims = compactDimensions(cfg.scale, isOverlayExpanded);
    const w = Math.min(dims.width, workArea.width);
    const h = Math.min(dims.height, workArea.height);
    return {
      x: workArea.x + 16,
      y: workArea.y + workArea.height - h - 16,
      width: w,
      height: h,
      gap: 0,
    };
  }

  const area = cfg.rest === 'taskbar' ? { ...bounds, y: bounds.y + 1, height: bounds.height - 1 } : workArea;
  const gap = area.y + area.height - (workArea.y + workArea.height);
  return { ...area, gap };
}

function overlayArea() {
  const b = targetBounds();
  return { area: { x: b.x, y: b.y, width: b.width, height: b.height }, gap: b.gap || 0 };
}

function findNiriOutputForDisplay(display, outputs) {
  if (!display || !outputs) return null;
  const match = Object.entries(outputs).find(([_, out]) =>
    Math.abs(out.logical.x - display.bounds.x) < 5 && Math.abs(out.logical.y - display.bounds.y) < 5
  );
  return match ? match[0] : null;
}

function syncNiriWindowPosition(targetX, targetY, targetDisplay) {
  if (process.platform !== 'linux') return;
  try {
    const { spawnSync } = require('node:child_process');
    const rawWins = spawnSync('niri', ['msg', '--json', 'windows'], { encoding: 'utf8', timeout: 1000 }).stdout;
    if (!rawWins) return;
    const wins = JSON.parse(rawWins);
    const capriWin = wins.find((w) => w.title === 'Capri');
    if (!capriWin) return;

    if (targetDisplay) {
      const rawOutputs = spawnSync('niri', ['msg', '--json', 'outputs'], { encoding: 'utf8', timeout: 1000 }).stdout;
      const outputs = rawOutputs ? JSON.parse(rawOutputs) : {};
      const targetOutput = findNiriOutputForDisplay(targetDisplay, outputs);
      if (targetOutput) {
        const rawWs = spawnSync('niri', ['msg', '--json', 'workspaces'], { encoding: 'utf8', timeout: 1000 }).stdout;
        const workspaces = rawWs ? JSON.parse(rawWs) : [];
        const currentWs = workspaces.find((w) => w.id === capriWin.workspace_id);
        if (currentWs && currentWs.output !== targetOutput) {
          spawnSync('niri', ['msg', 'action', 'move-window-to-monitor', '--id', String(capriWin.id), targetOutput], { timeout: 1000 });
        }
      }
    }

    const localTargetX = targetDisplay ? Math.round(targetX - targetDisplay.bounds.x) : Math.round(targetX);
    const localTargetY = targetDisplay ? Math.round(targetY - targetDisplay.bounds.y) : Math.round(targetY);

    const rawAfter = spawnSync('niri', ['msg', '--json', 'windows'], { encoding: 'utf8', timeout: 1000 }).stdout;
    const updatedWin = (rawAfter ? JSON.parse(rawAfter) : []).find((w) => w.id === capriWin.id) || capriWin;

    if (!updatedWin.layout?.tile_pos_in_workspace_view) return;
    const [currentX, currentY] = updatedWin.layout.tile_pos_in_workspace_view;
    const dx = Math.round(localTargetX - currentX);
    const dy = Math.round(localTargetY - currentY);
    if (dx !== 0 || dy !== 0) {
      const signX = dx >= 0 ? `+${dx}` : `${dx}`;
      const signY = dy >= 0 ? `+${dy}` : `${dy}`;
      spawnSync('niri', ['msg', 'action', 'move-floating-window', '--id', String(updatedWin.id), '-x', signX, '-y', signY], { timeout: 1000 });
    }
  } catch {
    // Omitir si no es Niri
  }
}

function fitOverlay() {
  if (!overlay) return;
  const { area, gap } = overlayArea();
  overlay.setBounds(area);
  overlay.webContents.send('overlay:resize', { width: area.width, height: area.height, gap });
  if (process.platform === 'linux') {
    syncNiriWindowPosition(area.x, area.y, targetDisplay());
  }
}

function moveOverlay(id) {
  if (!displays().some((d) => d.id === id)) return null;
  config.save({ displayId: id });
  fitOverlay();
  const { area } = overlayArea();
  overlay.setBounds(area);
  if (process.platform === 'linux') {
    syncNiriWindowPosition(area.x, area.y, targetDisplay());
  }
  windowWatch?.refresh();
  rebuildTray();
  sendCommand('screens');
  return area;
}

function rearmOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  if (process.platform !== 'linux') {
    overlay.setIgnoreMouseEvents(false);
    overlay.setIgnoreMouseEvents(true, { forward: true });
  }
  overlay.setAlwaysOnTop(true, 'screen-saver');
  fitOverlay();
  sendCommand('rearmed');
}

function createOverlay() {
  const { area } = overlayArea();
  overlay = new BrowserWindow({
    title: 'Capri',
    ...area,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: true,
    minWidth: 48,
    minHeight: 48,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform !== 'linux') {
    overlay.setIgnoreMouseEvents(true, { forward: true });
  }

  overlay.loadURL('capri://app/src/renderer/index.html');
  overlay.once('ready-to-show', () => {
    fitOverlay();
    overlay.showInactive();
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });
  overlay.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[capri] failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });
  overlay.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const src = sourceId ? String(sourceId).split('/').pop() : 'renderer';
    if (DEV || level >= 2) {
      console.log(`[renderer:${level}] ${message} (${src}:${line})`);
    }
  });

  if (DEV && process.env.CAPRI_DEVTOOLS) {
    overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out
function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  fitOverlay();
  overlay?.showInactive();
  sendCommand('stow', { on: !visible });
  overlay?.webContents.send('capri:config', rendererConfig());
  rebuildTray();
}

function toggleCompact(force) {
  const compact = typeof force === 'boolean' ? force : !config.load().compact;
  config.save({ compact });
  fitOverlay();
  rebuildTray();
  overlay?.webContents.send('capri:config', rendererConfig());
}

function resolveLang() {
  return 'es';
}

function rendererConfig() {
  const cfg = config.load();
  return { ...cfg, lang: resolveLang(cfg.lang), langSetting: cfg.lang };
}

function updateConfig(patch) {
  config.save(patch);
  fitOverlay();
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);

  if (cfg.mode === 'only-view') {
    if (bridgeServer) {
      bridgeServer.close();
      bridgeServer = null;
    }
  } else {
    if (!bridgeServer) {
      bridgeServer = createBridge({
        onEvent: (event) => {
          overlay?.webContents.send('ide:event', event);
        },
      });
    }
  }

  rebuildTray();
  return cfg;
}

function rebuildTray() {
  if (!tray) return;
  const cfg = config.load();
  const t = TRAY[resolveLang(cfg.lang)] || TRAY.es;

  const screenList = displays();
  const current = targetDisplay().id;

  const isFull = cfg.mode !== 'only-view';

  let niriOutputs = {};
  if (process.platform === 'linux') {
    try {
      const { spawnSync } = require('node:child_process');
      const raw = spawnSync('niri', ['msg', '--json', 'outputs'], { encoding: 'utf8', timeout: 500 }).stdout;
      if (raw) niriOutputs = JSON.parse(raw);
    } catch { }
  }

  const menuItems = [
    { label: `${t.title} (${isFull ? 'Full' : 'Only-View'})`, enabled: false },
    { type: 'separator' },
    {
      label: t.modeOnlyView || 'Modo: Solo Visual (Only-View)',
      type: 'radio',
      checked: !isFull,
      click: () => updateConfig({ mode: 'only-view' }),
    },
    {
      label: t.modeFull || 'Modo: Completo (IA + IDE + Shell)',
      type: 'radio',
      checked: isFull,
      click: () => updateConfig({ mode: 'full' }),
    },
    { type: 'separator' },
  ];

  if (isFull) {
    menuItems.push(
      { label: t.chat || 'Hablar con Capri', click: () => sendCommand('chat') },
      { label: 'Reconocimiento por voz (Ctrl+Alt+M)', click: () => sendCommand('voice') },
      { label: '🎙️ Reconocimiento por voz (Ctrl+Alt+M)', click: () => sendCommand('voice') },
      { label: 'Escanear pantalla', click: () => sendCommand('look') },
      {
        label: t.provider || 'Proveedor de IA',
        submenu: [
          {
            label: t.providerGemini || 'Google Gemini Flash',
            type: 'radio',
            checked: (cfg.aiProvider || 'gemini') === 'gemini',
            click: () => updateConfig({ aiProvider: 'gemini' }),
          },
          {
            label: t.providerOllama || 'Llama 3 (Ollama local)',
            type: 'radio',
            checked: cfg.aiProvider === 'ollama',
            click: () => updateConfig({ aiProvider: 'ollama' }),
          },
        ],
      },
      {
        label: 'Olvidar conversaciones',
        click: () => {
          saveMemory({ history: [] });
          overlay?.webContents.send('chat:forget');
        },
      },
      { type: 'separator' },
    );
  }

  menuItems.push(
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.possessNow, click: () => sendCommand('possess') },
    { label: t.celebrate, click: () => sendCommand('celebrate') },
    { label: t.intro, click: () => sendCommand('intro') },
    { label: t.teleport, accelerator: 'Ctrl+Alt+T', click: () => sendCommand('teleport') },
    { label: t.sleep, click: () => sendCommand('sleep') },
    { label: cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
    {
      label: t.compact,
      accelerator: 'Ctrl+Alt+V',
      type: 'checkbox',
      checked: Boolean(cfg.compact),
      click: (item) => toggleCompact(item.checked),
    },
  );

  if (isFull) {
    menuItems.push(
      { type: 'separator' },
      {
        label: t.commands || 'Comandos rápidos',
        submenu: commands.listCommands().map((cmd) => ({
          label: cmd.label,
          click: () => commands.runCommand(cmd.id),
        })),
      },
    );
  }

  menuItems.push(
    { type: 'separator' },
    {
      label: t.size,
      submenu: [
        [t.small, 0.45],
        [t.medium, 0.6],
        [t.large, 0.8],
        [t.huge, 1.0],
      ].map(([label, scale]) => ({
        label,
        type: 'radio',
        checked: Math.abs(cfg.scale - scale) < 0.01,
        click: () => updateConfig({ scale }),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: t.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    {
      label: t.screen,
      enabled: screenList.length > 1,
      submenu: screenList.map((d, i) => {
        const match = Object.entries(niriOutputs).find(([_, out]) =>
          Math.abs(out.logical.x - d.bounds.x) < 5 && Math.abs(out.logical.y - d.bounds.y) < 5
        );
        const outName = match ? ` (${match[0]})` : '';
        return {
          label: `${i + 1} — ${d.size.width}×${d.size.height}${outName}`,
          type: 'radio',
          checked: d.id === current,
          click: () => {
            moveOverlay(d.id);
          },
        };
      }),
    },
    {
      label: t.motion,
      submenu: [
        ['auto', t.motionAuto],
        ['full', t.motionFull],
        ['reduced', t.motionReduced],
      ].map(([motion, label]) => ({
        label,
        type: 'radio',
        checked: (cfg.motion || 'auto') === motion,
        click: () => updateConfig({ motion, motionAsked: true }),
      })),
    },
    {
      label: t.display,
      submenu: [
        ['auto', t.displayAuto],
        ['gl', t.displayGl],
        ['software', t.displaySoftware],
      ].map(([render, label]) => ({
        label,
        type: 'radio',
        checked: (cfg.render || 'auto') === render,
        click: () => {
          if (cfg.render === render) return;
          config.save({ render });
          app.relaunch();
          app.quit();
        },
      })),
    },
    {
      label: t.theme || 'Estilo de sus ventanas',
      submenu: [
        { label: 'Night City', type: 'radio', checked: (cfg.theme || 'nightcity') === 'nightcity', click: () => updateConfig({ theme: 'nightcity' }) },
        { label: t.themeClassic || 'Clásico (Classique)', type: 'radio', checked: cfg.theme === 'classic', click: () => updateConfig({ theme: 'classic' }) },
      ],
    },
    { label: t.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: t.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },

    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  );

  const menu = Menu.buildFromTemplate(menuItems);

  tray.setContextMenu(menu);
  trayMenu = menu;
}

function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Capri');
  tray.on('click', () => sendCommand('status'));
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('overlay:interactive', (_e, on) => {
    if (process.platform !== 'linux') {
      overlay?.setIgnoreMouseEvents(!on, { forward: true });
    }
  });
  ipcMain.on('overlay:expanded', (_e, on) => {
    if (isOverlayExpanded !== Boolean(on)) {
      isOverlayExpanded = Boolean(on);
      fitOverlay();
    }
  });
  ipcMain.on('overlay:set-shape', (_e, rects) => {
    if (!overlay || overlay.isDestroyed()) return;
    const cfg = config.load();
    if (cfg.compact || !cfg.visible) return;
    if (process.platform === 'linux' && typeof overlay.setShape === 'function') {
      try {
        if (!Array.isArray(rects) || !rects.length) return;
        overlay.setShape(rects);
      } catch (err) {
        console.error('[capri] setShape error:', err);
      }
    }
  });
  ipcMain.on('overlay:rearm', () => rearmOverlay());
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay?.getBounds() || { x: 0, y: 0, width: 0, height: 0 };
    const inside = p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
    return { x: p.x - b.x, y: p.y - b.y, inside, display: displayAt(p).id };
  });
  ipcMain.handle('screens:list', () => {
    const o = overlay?.getBounds() || { x: 0, y: 0 };
    return {
      current: targetDisplay().id,
      origin: { x: o.x, y: o.y },
      list: displays().map(({ id, bounds: b }) => ({ id, x: b.x, y: b.y, w: b.width, h: b.height })),
    };
  });
  ipcMain.handle('screens:move', async (_e, id) => {
    const area = moveOverlay(id);
    if (!area) return null;
    await new Promise((r) => setTimeout(r, 60));
    overlay?.setBounds(area);
    const o = overlay?.getBounds() || area;
    return { origin: { x: o.x, y: o.y }, width: o.width, height: o.height, gap: overlayArea().gap };
  });

  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('hooks:status', () => ({ installed: true, file: '' }));
  ipcMain.handle('hooks:install', () => ({ action: 'install', ok: true }));
  ipcMain.handle('claude:found', () => false);
  ipcMain.on('claude:help', () => shell.openExternal('https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview'));
  ipcMain.handle('guide:tray', () => ({ icon: null, corner: null }));
  ipcMain.handle('guide:claudeFolder', () => ({ found: false, dir: '' }));
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('window:toggle-compact', () => toggleCompact());
  ipcMain.handle('window:toggle-visible', () => toggleVisible());
  ipcMain.on('menu:open', () => trayMenu?.popup({ window: overlay }));
  ipcMain.handle('windows:get', () => lastWindows);

  ipcMain.handle('sounds:list', () => {
    try {
      const dir = userSoundsDir();
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => SOUND_EXT.test(f));
    } catch {
      return [];
    }
  });

  ipcMain.handle('commands:list', () => commands.listCommands());
  ipcMain.handle('commands:run', (_e, id) => commands.runCommand(id));

  const chats = new Map();
  ipcMain.handle('chat:status', async () => ai.status(config.load()));
  ipcMain.handle('chat:send', async (_e, { id, messages }) => {
    const cfg = config.load();
    const abort = new AbortController();
    chats.set(id, abort);
    try {
      const sendDelta = (text) => overlay?.webContents.send('chat:delta', { id, text });
      const text = await ai.chat({ messages, provider: cfg.aiProvider }, sendDelta, abort.signal);
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message };
    } finally {
      chats.delete(id);
    }
  });
  ipcMain.on('chat:stop', (_e, id) => {
    const c = chats.get(id);
    if (c) {
      c.abort();
      chats.delete(id);
    }
  });
  ipcMain.handle('chat:memory', () => readMemory().history || []);
  ipcMain.on('chat:remember', (_e, history) => Array.isArray(history) && saveMemory({ history }));
  ipcMain.handle('audio:transcribe', async (_e, { base64, mimeType }) => {
    try {
      const text = await ai.transcribeAudio({ base64, mimeType });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('look:snap', async () => {
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      snaps.set(id, await snapScreen());
      setTimeout(() => snaps.delete(id), 120000);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('look:say', (_e, request) => sayAboutSnap(request || {}));
  ipcMain.handle('look:where', () => {
    const cfg = config.load();
    return {
      local: cfg.aiProvider === 'ollama',
      provider: cfg.aiProvider === 'gemini' ? 'Google Gemini Flash' : 'Ollama local',
      model: cfg.aiProvider === 'gemini' ? ai.gemini.getModel() : 'llama3'
    };
  });
  ipcMain.on('overlay:focus', (_e, on) => {
    if (overlay && !overlay.isDestroyed()) {
      if (on) {
        overlay.setFocusable(true);
        overlay.focus();
      } else {
        overlay.setFocusable(false);
      }
    }
  });
  ipcMain.handle('windows:closePage', (_e, { id, key }) => windowWatch?.close?.(id, key) ?? 'gone');
  let cpuBefore = null;
  ipcMain.handle('pc:cpu', () => {
    const now = os.cpus().map(({ times: t }) => ({ idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }));
    const before = cpuBefore;
    cpuBefore = now;
    if (!before) return null;
    let idle = 0, total = 0;
    now.forEach((c, i) => {
      idle += c.idle - (before[i]?.idle ?? 0);
      total += c.total - (before[i]?.total ?? 0);
    });
    return total > 0 ? Math.round(((total - idle) / total) * 100) : 0;
  });
  ipcMain.handle('pc:do', (_e, req) => Promise.resolve(system.act(req, { display: targetDisplay() })).catch(() => null));
  ipcMain.handle('apps:list', () => apps.list());
  ipcMain.handle('apps:find', (_e, wanted) => apps.find(wanted));
  ipcMain.handle('apps:close', (_e, { name, force }) => apps.close(name, { force }));
  ipcMain.handle('apps:findLaunch', async (_e, text) => launcher.find(String(text || '')));
  ipcMain.handle('apps:launch', async (_e, item) => launcher.launch(item));
  ipcMain.handle('apps:site', async (_e, req) => {
    const url = typeof req === 'string' ? req : req?.url;
    const browser = typeof req === 'object' ? req.browser : null;
    return launcher.openUrl(url, browser);
  });
  ipcMain.handle('files:open', async (_e, { file, reveal }) => {
    try {
      if (reveal) shell.showItemInFolder(file);
      else await shell.openPath(file);
      return true;
    } catch {
      return false;
    }
  });
}

function main() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('[capri] Ya hay una instancia de Capri ejecutándose. Cierra la anterior si deseas reiniciar.');
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (overlay) {
      overlay.showInactive();
      fitOverlay();
    }
    sendCommand('status');
  });

  app.setName('capri-desktop');

  app.whenReady().then(() => {
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      if (permission === 'media') return true;
      return false;
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media') return callback(true);
      callback(false);
    });

    serveProtocol();
    registerIpc();
    createOverlay();
    createTray();

    windowWatch = startWindowWatch({
      overlay,
      onUpdate: (data) => {
        lastWindows = data;
        overlay?.webContents.send('windows:update', data);
      },
    });

    bridgeServer = createBridge({
      onEvent: (event) => {
        overlay?.webContents.send('ide:event', event);
      },
      onCommand: (cmd) => {
        const name = cmd.name || cmd.command;
        if (name === 'visible' || name === 'toggle-visible') toggleVisible();
        else if (name === 'compact' || name === 'toggle-compact') toggleCompact();
        else if (name) sendCommand(name, cmd.payload || cmd);
      },
    });

    if (config.load().mode !== 'only-view') {
      ai.warmOllama();
    }

    globalShortcut.register('Control+Alt+C', () => toggleVisible());
    globalShortcut.register('Control+Alt+V', () => toggleCompact());
    globalShortcut.register('Control+Alt+M', () => sendCommand('voice'));
    globalShortcut.register('Control+Alt+S', () => sendCommand('satellite'));
    globalShortcut.register('Control+Alt+P', () => sendCommand('possess'));
    globalShortcut.register('Control+Alt+T', () => sendCommand('teleport'));

    const screensChanged = () => {
      fitOverlay();
      windowWatch?.refresh();
      rebuildTray();
      sendCommand('screens');
    };
    screen.on('display-metrics-changed', screensChanged);
    screen.on('display-added', screensChanged);
    screen.on('display-removed', screensChanged);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    bridgeServer?.close();
  });

  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
