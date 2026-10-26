'use strict';

// Gestión de ventanas y aplicaciones para Linux (Niri Wayland).
// Permite listar ventanas activas, buscar por nombre y cerrarlas a petición del usuario.

const { execSync, spawnSync } = require('node:child_process');

const KEEP = new Set([
  'capri', 'electron', 'systemd', 'waybar', 'niri', 'noctalia', 'pipewire', 'wireplumber',
]);

function getNiriWindows() {
  try {
    const raw = execSync('niri msg --json windows', { encoding: 'utf8', timeout: 2000 });
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function list() {
  const windows = getNiriWindows();
  const apps = new Map();

  for (const win of windows) {
    const appId = String(win.app_id || win.title || '').trim();
    const nameLower = appId.toLowerCase();

    if (!appId || win.pid === process.pid || KEEP.has(nameLower)) continue;

    if (!apps.has(nameLower)) {
      apps.set(nameLower, {
        id: win.id,
        pid: win.pid,
        name: appId,
        process: appId,
        label: win.title || appId,
      });
    }
  }

  return [...apps.values()];
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

async function find(wanted) {
  const key = simple(wanted);
  if (key.length < 2) return null;

  const apps = await list();
  const score = (app) => {
    const names = [simple(app.name), simple(app.label)].filter(Boolean);
    if (names.includes(key)) return 3;
    if (names.some((n) => n.startsWith(key) || key.startsWith(n))) return 2;
    if (key.length >= 3 && names.some((n) => n.includes(key) || key.includes(n))) return 1;
    return 0;
  };

  const best = apps.map((app) => [score(app), app]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0];
  return best ? best[1] : null;
}

async function close(name, { force = false } = {}) {
  const app = await find(name);
  if (!app) return { running: false };

  try {
    if (force && app.pid) {
      spawnSync('kill', ['-9', String(app.pid)], { timeout: 1000 });
    } else {
      // Intentar primero vía niri close-window
      if (app.id) {
        spawnSync('niri', ['msg', 'action', 'close-window', '--id', String(app.id)], { timeout: 1000 });
      } else if (app.pid) {
        spawnSync('kill', ['-15', String(app.pid)], { timeout: 1000 });
      }
    }

    // Verificar si sigue en ejecución
    const still = (await list()).some((a) => a.id === app.id);
    return { running: still };
  } catch (err) {
    console.error('[capri:apps] Error al cerrar app:', err.message);
    return { running: true, error: err.message };
  }
}

module.exports = { list, find, close };
