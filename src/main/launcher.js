'use strict';

// Lanzador de aplicaciones y comandos de terminal para Linux (Niri Wayland).
// Descubre aplicaciones .desktop de sistema y Flatpak, aliases conocidos y comandos en PATH.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');
const commandsConfig = require('./commands');

const DESKTOP_DIRS = [
  '/usr/share/applications',
  '/var/lib/flatpak/exports/share/applications',
  path.join(os.homedir(), '.local/share/applications'),
  path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
];

const CLI_TOOLS = new Set([
  'htop', 'btop', 'top', 'fastfetch', 'neofetch', 'cmatrix', 'nvtop', 'ranger', 'yazi',
  'lazygit', 'ncdu', 'git', 'vim', 'nvim', 'nano', 'tmux', 'bash', 'zsh', 'fish',
]);

const ALIASES = {
  chrome: { name: 'Google Chrome', command: 'flatpak run --command=/app/bin/chrome com.google.Chrome' },
  'google chrome': { name: 'Google Chrome', command: 'flatpak run --command=/app/bin/chrome com.google.Chrome' },
  brave: { name: 'Brave Browser', command: 'brave' },
  'brave browser': { name: 'Brave Browser', command: 'brave' },
  dolphin: { name: 'Dolphin', command: 'dolphin' },
  explorador: { name: 'Dolphin', command: 'dolphin' },
  archivos: { name: 'Dolphin', command: 'dolphin' },
  terminal: { name: 'Kitty', command: 'kitty' },
  consola: { name: 'Kitty', command: 'kitty' },
  kitty: { name: 'Kitty', command: 'kitty' },
  alacritty: { name: 'Alacritty', command: 'alacritty' },
  antigravity: { name: 'Antigravity IDE', command: 'antigravity' },
  ferdium: { name: 'Ferdium', command: 'flatpak run org.ferdium.Ferdium' },
  discord: { name: 'Ferdium', command: 'flatpak run org.ferdium.Ferdium' },
};

let cachedApps = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

function cleanExec(exec) {
  if (!exec) return '';
  return exec
    .replace(/@@u\s+%U\s+@@/g, '')
    .replace(/@@[a-z]\s+%[a-z]\s+@@/gi, '')
    .replace(/%[a-zA-Z]/g, '')
    .trim();
}

function parseDesktopFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let inDesktopEntry = false;
    let name = '';
    let exec = '';
    let terminal = false;
    let noDisplay = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('[')) {
        inDesktopEntry = line === '[Desktop Entry]';
        continue;
      }
      if (!inDesktopEntry || line.startsWith('#') || !line.includes('=')) continue;

      const [key, ...vals] = line.split('=');
      const val = vals.join('=').trim();

      if (key === 'Name' && !name) name = val;
      else if (key === 'Exec' && !exec) exec = val;
      else if (key === 'Terminal') terminal = val.toLowerCase() === 'true';
      else if (key === 'NoDisplay') noDisplay = val.toLowerCase() === 'true';
    }

    if (!name || !exec || noDisplay) return null;

    return {
      id: path.basename(filePath, '.desktop'),
      name,
      exec: cleanExec(exec),
      terminal,
      path: filePath,
    };
  } catch {
    return null;
  }
}

function scanApps() {
  const now = Date.now();
  if (cachedApps && now - cacheTime < CACHE_TTL) return cachedApps;

  const apps = [];
  const seenIds = new Set();

  for (const dir of DESKTOP_DIRS) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.desktop')) continue;
        const fullPath = path.join(dir, file);
        const app = parseDesktopFile(fullPath);
        if (app && !seenIds.has(app.id.toLowerCase())) {
          seenIds.add(app.id.toLowerCase());
          apps.push(app);
        }
      }
    } catch (err) {
      console.error(`[capri:launcher] Error escaneando ${dir}:`, err.message);
    }
  }

  cachedApps = apps;
  cacheTime = now;
  return apps;
}

const normalize = (str) =>
  String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function findExecutableInPath(bin) {
  try {
    const out = execSync(`which ${JSON.stringify(bin)} 2>/dev/null`, { encoding: 'utf8', timeout: 500 }).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function find(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  // 1. Detectar si se pide explícitamente ejecutar un comando en la terminal
  const termMatch = text.match(/(?:ejecuta|corre|lanzar?|run|exec)\s+(?:en\s+(?:la\s+)?(?:terminal|consola)\s*[:]?\s*|(?:el\s+)?comando\s*[:]?\s*)(.+)/i);
  if (termMatch && termMatch[1]) {
    const cmd = termMatch[1].trim().replace(/^[`'"]|[`'"]$/g, '');
    return {
      id: 'cmd-terminal',
      name: cmd,
      command: cmd,
      inTerminal: true,
      kind: 'terminal',
    };
  }

  // 2. Extraer nombre eliminando verbos de apertura y artículos
  let query = text
    .replace(/^(?:por\s+favor\s+|podr[ií]as\s+|quiero\s+que\s+)?/i, '')
    .replace(/^(?:abre|abrir|ábreme|abreme|inicia|iniciar|lanza|lanzar|ejecuta|ejecutar|corre|correr|open|launch|start|run)\s+/i, '')
    .replace(/^(?:la|el|los|las|un|una|mi|app|aplicaci[oó]n|programa|comando)\s+/i, '')
    .replace(/[.!?¿¡]+$/g, '')
    .trim();

  const key = normalize(query);
  if (!key) return null;

  // 3. Comprobar aliases rápidos
  if (ALIASES[key]) {
    const a = ALIASES[key];
    return {
      id: `alias-${key}`,
      name: a.name,
      command: a.command,
      inTerminal: Boolean(a.inTerminal),
      kind: 'app',
    };
  }

  // 4. Comprobar config/commands.json
  const customMap = commandsConfig.loadCommandMap();
  for (const cmd of Object.values(customMap)) {
    if (normalize(cmd.id) === key || normalize(cmd.label).includes(key)) {
      return {
        id: cmd.id,
        name: cmd.label,
        command: cmd.command,
        args: cmd.args || [],
        kind: 'command',
      };
    }
  }

  // 5. Comprobar aplicaciones instaladas (.desktop)
  const apps = scanApps();
  // Búsqueda por coincidencia exacta
  const exact = apps.find((a) => normalize(a.name) === key || normalize(a.id) === key);
  if (exact) {
    return {
      id: exact.id,
      name: exact.name,
      command: exact.exec,
      inTerminal: exact.terminal,
      kind: 'app',
    };
  }

  // Búsqueda por inclusión de palabras
  const candidate = apps.find((a) => {
    const n = normalize(a.name);
    const id = normalize(a.id);
    return n.includes(key) || id.includes(key) || key.includes(n);
  });
  if (candidate) {
    return {
      id: candidate.id,
      name: candidate.name,
      command: candidate.exec,
      inTerminal: candidate.terminal,
      kind: 'app',
    };
  }

  // 6. Comprobar si es un binario disponible en PATH
  const binPath = findExecutableInPath(query.split(' ')[0]);
  if (binPath) {
    const isCli = CLI_TOOLS.has(path.basename(binPath).toLowerCase());
    return {
      id: `bin-${path.basename(binPath)}`,
      name: query,
      command: query,
      inTerminal: isCli,
      kind: 'bin',
    };
  }

  // 7. Si empieza con "ejecuta" o "corre", interpretarlo como comando de terminal
  if (/^(?:ejecuta|corre|exec|run)\s+/i.test(text)) {
    return {
      id: 'cmd-raw',
      name: query,
      command: query,
      inTerminal: true,
      kind: 'terminal',
    };
  }

  return null;
}

async function launch(item) {
  if (!item) return { ok: false, error: 'No se especificó comando o aplicación' };

  try {
    let child;
    if (item.inTerminal) {
      // Lanzar en kitty con bash para mantener visible la salida
      child = spawn('kitty', ['-e', 'bash', '-c', `${item.command}; echo ''; echo 'Presiona Enter para cerrar...'; read -r`], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
    } else if (Array.isArray(item.args) && item.args.length) {
      child = spawn(item.command, item.args, {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
    } else {
      child = spawn('bash', ['-c', item.command], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
    }

    child.unref();
    return { ok: true, name: item.name };
  } catch (err) {
    console.error(`[capri:launcher] Falló al lanzar ${item.name}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function openUrl(rawUrl, browser = null) {
  let targetUrl = String(rawUrl || '').trim();
  if (!targetUrl) return false;
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  const b = String(browser || '').toLowerCase();
  try {
    if (b.includes('chrome')) {
      const child = spawn('/usr/bin/flatpak', ['run', '--command=/app/bin/chrome', 'com.google.Chrome', targetUrl], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      return true;
    }

    if (b.includes('brave')) {
      const child = spawn('brave', [targetUrl], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      return true;
    }

    const { shell } = require('electron');
    if (shell && typeof shell.openExternal === 'function') {
      await shell.openExternal(targetUrl);
      return true;
    }

    const child = spawn('xdg-open', [targetUrl], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return true;
  } catch (err) {
    console.error(`[capri:launcher] Error al abrir URL (${targetUrl}):`, err.message);
    return false;
  }
}

module.exports = {
  find,
  launch,
  openUrl,
  scanApps,
};

