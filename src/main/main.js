'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { startWindowWatch } = require('./windows');
const commands = require('./commands');
const { loadEnv } = require('./env');
const ai = require('./ai');
const apps = require('./apps');
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
let currentHitRects = [];
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
  } catch {}
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

let isOverlayExpanded = false;

function compactDimensions(scale = 0.6, expanded = false) {
  const s = typeof scale === 'number' && scale > 0 ? scale : 0.6;
  if (expanded) {
    const w = Math.round(Math.max(280, 240 + 100 * s));
    const h = Math.round(Math.max(330, 260 + 120 * s));
    return { width: w, height: h };
  }
  // Modo widget mínimo: recuadro ceñido exactamente alrededor de Capri
  const w = Math.round(Math.max(130, 80 + 110 * s));
  const h = Math.round(Math.max(180, 120 + 160 * s));
  return { width: w, height: h };
}

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

function targetBounds() {
  const { workArea } = targetDisplay();
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
    };
  }
  return workArea;
}

function syncNiriWindowPosition(targetX, targetY) {
  if (process.platform !== 'linux') return;
  try {
    const { execSync } = require('node:child_process');
    const out = execSync('niri msg --json windows', { timeout: 1000 }).toString();
    const wins = JSON.parse(out);
    const capriWin = wins.find((w) => w.title === 'Capri');
    if (!capriWin || !capriWin.layout?.tile_pos_in_workspace_view) return;
    const [currentX, currentY] = capriWin.layout.tile_pos_in_workspace_view;
    const dx = Math.round(targetX - currentX);
    const dy = Math.round(targetY - currentY);
    if (dx !== 0 || dy !== 0) {
      const signX = dx >= 0 ? `+${dx}` : `${dx}`;
      const signY = dy >= 0 ? `+${dy}` : `${dy}`;
      execSync(`niri msg action move-floating-window --id ${capriWin.id} -x '${signX}' -y '${signY}'`, { timeout: 1000 });
    }
  } catch {
    // Omitir si no es Niri
  }
}

function fitOverlay() {
  if (!overlay) return;
  const b = targetBounds();
  overlay.setBounds(b);
  overlay.webContents.send('overlay:resize', { width: b.width, height: b.height });
  setTimeout(() => syncNiriWindowPosition(b.x, b.y), 50);
}

function createOverlay() {
  const bounds = targetBounds();
  overlay = new BrowserWindow({
    title: 'Capri',
    ...bounds,
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
    type: 'toolbar',
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

  overlay.loadURL('capri://app/src/renderer/index.html');
  overlay.once('ready-to-show', () => {
    overlay.showInactive();
    const b = targetBounds();
    setTimeout(() => syncNiriWindowPosition(b.x, b.y), 100);
    if (process.platform === 'linux' && typeof overlay?.setShape === 'function') {
      overlay.setShape([{ x: 0, y: 0, width: 1, height: 1 }]);
    }
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

  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;

  const isFull = cfg.mode !== 'only-view';

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
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.save({ displayId: d.id }); fitOverlay(); rebuildTray(); },
      })),
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


  ipcMain.on('overlay:set-shape', (_e, rects) => {
    if (!overlay || overlay.isDestroyed()) return;
    const b = overlay.getBounds();
    const valid = [];
    if (Array.isArray(rects)) {
      for (const r of rects) {
        if (!r || typeof r.width !== 'number' || typeof r.height !== 'number') continue;
        const x1 = Math.max(0, Math.floor(r.x));
        const y1 = Math.max(0, Math.floor(r.y));
        const x2 = Math.min(b.width, Math.ceil(r.x + r.width));
        const y2 = Math.min(b.height, Math.ceil(r.y + r.height));
        if (x2 > x1 && y2 > y1) {
          valid.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
        }
      }
    }
    currentHitRects = valid.length > 0 ? valid : [{ x: 0, y: 0, width: 1, height: 1 }];
    if (process.platform === 'linux' && typeof overlay?.setShape === 'function') {
      try {
        overlay.setShape(currentHitRects);
      } catch (err) {
        console.error('[capri] setShape error:', err.message);
      }
    }
  });

  ipcMain.on('overlay:expanded', (_e, on) => {
    if (isOverlayExpanded !== Boolean(on)) {
      isOverlayExpanded = Boolean(on);
      fitOverlay();
    }
  });

  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });

  ipcMain.handle('config:get', () => rendererConfig());
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
  ipcMain.handle('apps:list', () => apps.list());
  ipcMain.handle('apps:find', (_e, wanted) => apps.find(wanted));
  ipcMain.handle('apps:close', (_e, { name, force }) => apps.close(name, { force }));
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

    if (config.load().mode !== 'only-view') {
      bridgeServer = createBridge({
        onEvent: (event) => {
          overlay?.webContents.send('ide:event', event);
        },
      });
      ai.warmOllama();
    }

    globalShortcut.register('Control+Alt+C', () => toggleVisible());
    globalShortcut.register('Control+Alt+S', () => sendCommand('satellite'));
    globalShortcut.register('Control+Alt+P', () => sendCommand('possess'));
    globalShortcut.register('Control+Alt+T', () => sendCommand('teleport'));

    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    bridgeServer?.close();
  });

  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
