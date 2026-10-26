'use strict';

// Despachador de comandos de shell para Linux (CachyOS / Niri).
// Mapea y ejecuta comandos permitidos de forma asíncrona y desacoplada (detached).

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(ROOT, 'config', 'commands.json');

function loadCommandMap() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return data.commands || {};
    }
  } catch (err) {
    console.error('[capri:commands] Error al cargar commands.json:', err.message);
  }
  return {
    brave: { id: 'brave', label: 'Abrir Brave Browser', command: 'brave', args: [] },
    dolphin: { id: 'dolphin', label: 'Abrir Dolphin', command: 'dolphin', args: [] },
  };
}

function listCommands() {
  const map = loadCommandMap();
  return Object.values(map).map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description || '',
  }));
}

function runCommand(commandId) {
  const map = loadCommandMap();
  const entry = map[commandId];

  if (!entry) {
    return { ok: false, error: `Comando no permitido o desconocido: ${commandId}` };
  }

  try {
    const child = spawn(entry.command, entry.args || [], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });

    child.unref();
    return { ok: true, command: entry.command, id: commandId };
  } catch (err) {
    console.error(`[capri:commands] Falló al ejecutar ${commandId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  loadCommandMap,
  listCommands,
  runCommand,
};
