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

const ROOT = path.resolve(__dirname, '..', '..');
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

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

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

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

function fitOverlay() {
  if (!overlay) return;
  const { workArea } = targetDisplay();
  overlay.setBounds(workArea);
  overlay.webContents.send('overlay:resize', { width: workArea.width, height: workArea.height });
}

function createOverlay() {
  const { workArea } = targetDisplay();
  overlay = new BrowserWindow({
    title: 'Capri',
    ...workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
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
  if (process.platform === 'win32') {
    overlay.setIgnoreMouseEvents(true, { forward: true });
  }

  overlay.loadURL('capri://app/src/renderer/index.html');
  overlay.once('ready-to-show', () => overlay.showInactive());
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });

  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out
function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'es';
}

function rendererConfig() {
  const cfg = config.load();
  return { ...cfg, lang: resolveLang(cfg.lang), langSetting: cfg.lang };
}

function updateConfig(patch) {
  config.save(patch);
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  rebuildTray();
  return cfg;
}

function rebuildTray() {
  if (!tray) return;
  const cfg = config.load();
  const t = TRAY[resolveLang(cfg.lang)] || TRAY.es;

  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;

  const menu = Menu.buildFromTemplate([
    { label: t.title, enabled: false },
    { type: 'separator' },
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.possessNow, click: () => sendCommand('possess') },
    { label: t.celebrate, click: () => sendCommand('celebrate') },
    { label: t.intro, click: () => sendCommand('intro') },
    { label: t.teleport, accelerator: 'Ctrl+Alt+T', click: () => sendCommand('teleport') },
    { label: t.sleep, click: () => sendCommand('sleep') },
    { label: cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
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
      label: t.lang,
      submenu: [[t.auto, 'auto'], ...LANGS.map((lang) => [TRAY[lang].name, lang])].map(([label, lang]) => ({
        label,
        type: 'radio',
        checked: cfg.lang === lang,
        click: () => updateConfig({ lang }),
      })),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]);

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
    if (process.platform === 'win32') {
      overlay?.setIgnoreMouseEvents(!on, { forward: true });
    } else if (process.platform === 'linux' && typeof overlay?.setShape === 'function') {
      try {
        if (on) {
          overlay.setShape([]);
        } else {
          overlay.setShape(currentHitRects);
        }
      } catch (err) {
        console.error('[capri] setShape error:', err.message);
      }
    }
  });

  ipcMain.on('overlay:set-shape', (_e, rects) => {
    currentHitRects = Array.isArray(rects) ? rects : [];
    if (process.platform === 'linux' && typeof overlay?.setShape === 'function') {
      try {
        overlay.setShape(currentHitRects);
      } catch (err) {
        console.error('[capri] setShape error:', err.message);
      }
    }
  });

  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });

  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
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
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));

  if (process.platform === 'win32') {
    app.setAppUserModelId('capri.desktop');
  } else {
    app.setName('capri-desktop');
  }

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
  });

  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
