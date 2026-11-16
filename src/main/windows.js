'use strict';

// Capri window watcher for Linux (Niri Wayland compositor).
// Tracks active workspaces, focused windows, and window boundaries in Niri's
// scrolling layout so Capri can sit on window borders or react to window focus.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync, execSync } = require('node:child_process');

function startNiriWatch({ overlay, onUpdate }) {
  let child = null;
  let stopped = false;
  let cachedWindows = [];
  let cachedWorkspaces = [];
  let computeTimer = null;

  function getOutputsMap() {
    try {
      const raw = spawnSync('niri', ['msg', '--json', 'outputs'], { encoding: 'utf8', timeout: 2000 }).stdout;
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function compute() {
    if (!overlay || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();

    const activeWs = cachedWorkspaces.find((w) => w.is_active);
    if (!activeWs) return;

    const outputs = getOutputsMap();
    const activeLogical = outputs[activeWs.output]?.logical;
    const screenW = activeLogical?.width || bounds.width || 1920;
    const screenH = activeLogical?.height || bounds.height || 1080;

    const currentWins = cachedWindows.filter(
      (w) => w.workspace_id === activeWs.id && w.app_id !== 'capri' && w.pid !== process.pid
    );
    const focusedWin =
      currentWins.find((w) => w.is_focused) ||
      currentWins.find((w) => w.id === activeWs.active_window_id);
    const fg = focusedWin ? focusedWin.id : 0;

    const gap = 12;
    const focusedCol = focusedWin?.layout?.pos_in_scrolling_layout?.[0] || 1;
    const focusedW = focusedWin?.layout?.window_size?.[0] || (screenW - gap * 2);
    const focusedLeft = Math.round((screenW - focusedW) / 2);

    const cols = new Map();
    for (const w of currentWins) {
      const colIdx = w.layout?.pos_in_scrolling_layout?.[0] || 1;
      if (!cols.has(colIdx)) cols.set(colIdx, []);
      cols.get(colIdx).push(w);
    }

    const colX = new Map();
    colX.set(focusedCol, focusedLeft);

    const sortedColIndices = [...cols.keys()].sort((a, b) => a - b);
    for (let c = focusedCol - 1; c >= Math.min(...sortedColIndices); c--) {
      if (cols.has(c)) {
        const colWins = cols.get(c);
        const w = colWins[0]?.layout?.window_size?.[0] || 750;
        const rightNeighborX = colX.get(c + 1) ?? 0;
        colX.set(c, rightNeighborX - gap - w);
      }
    }
    for (let c = focusedCol + 1; c <= Math.max(...sortedColIndices); c++) {
      if (cols.has(c)) {
        const prevWins = cols.get(c - 1);
        const prevW = prevWins?.[0]?.layout?.window_size?.[0] || 750;
        const leftNeighborX = colX.get(c - 1) ?? 0;
        colX.set(c, leftNeighborX + prevW + gap);
      }
    }

    const resultWins = [];
    for (const [colIdx, colWins] of cols.entries()) {
      const x = colX.get(colIdx);
      let y = gap;
      for (const w of colWins) {
        const winW = Math.round(w.layout?.window_size?.[0] || 750);
        const winH = Math.round(w.layout?.window_size?.[1] || 840);
        const relX = x - bounds.x;
        const relY = y - bounds.y;
        if (relX < bounds.width && relX + winW > 0 && relY < bounds.height && relY + winH > 0) {
          resultWins.push({
            id: w.id,
            x: relX,
            y: relY,
            w: winW,
            h: winH,
            max: winW >= screenW && winH >= screenH,
          });
        }
        y += winH + gap;
      }
    }

    onUpdate({ fg, wins: resultWins });
  }

  const scheduleCompute = () => {
    clearTimeout(computeTimer);
    computeTimer = setTimeout(compute, 50);
  };

  const start = () => {
    try {
      child = spawn('niri', ['msg', '--json', 'event-stream'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          const ev = JSON.parse(line);
          if (ev.WorkspacesChanged) {
            cachedWorkspaces = ev.WorkspacesChanged.workspaces;
            scheduleCompute();
          } else if (ev.WindowsChanged) {
            cachedWindows = ev.WindowsChanged.windows;
            scheduleCompute();
          } else if (ev.WorkspaceActivated) {
            scheduleCompute();
          }
        } catch {
          // ignore non-json
        }
      });

      child.stderr.on('data', (d) => console.error('[capri] niri watch:', String(d).trim()));
      child.on('exit', () => {
        child = null;
        if (!stopped) setTimeout(start, 3000);
      });
    } catch (err) {
      console.warn('[capri] Niri event stream not available:', err.message);
    }
  };

  start();
  return {
    refresh() {
      scheduleCompute();
    },
    stop() {
      stopped = true;
      clearTimeout(computeTimer);
      child?.kill();
    },
  };
}

function startWindowWatch({ overlay, onUpdate }) {
  try {
    if (process.env.NIRI_SOCKET || spawnSync('which', ['niri']).status === 0) {
      return startNiriWatch({ overlay, onUpdate });
    }
  } catch {
    // not niri
  }
  return { stop() {}, refresh() {} };
}

function getWindows() {
  try {
    if (process.platform === 'linux') {
      const raw = execSync('niri msg -j windows', { encoding: 'utf8', timeout: 3000 });
      const list = JSON.parse(raw || '[]');
      return list.map((w) => ({
        id: w.id,
        title: w.title || '',
        app_id: w.app_id || '',
        workspace_id: w.workspace_id,
      }));
    }

    if (process.platform === 'win32') {
      const psScript = path.join(__dirname, '..', '..', 'scripts', 'windows.ps1');
      if (fs.existsSync(psScript)) {
        const raw = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" list`, {
          encoding: 'utf8',
          timeout: 4000,
        });
        const parsed = JSON.parse(raw || '[]');
        return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
      }
      const raw = execSync(
        'powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json"',
        { encoding: 'utf8', timeout: 4000 }
      );
      const parsed = JSON.parse(raw || '[]');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.filter(Boolean).map((p) => ({
        id: p.Id,
        title: p.MainWindowTitle || '',
        app_id: p.ProcessName || '',
        workspace_id: 1,
      }));
    }

    return [];
  } catch (err) {
    console.warn('[capri:windows] Error al listar ventanas:', err.message);
    return [];
  }
}

function normalizeAction(action) {
  const map = {
    abrir: 'spawn',
    spawn: 'spawn',
    cerrar: 'close',
    close: 'close',
    enfocar: 'focus',
    focus: 'focus',
    workspace: 'workspace',
  };
  return map[String(action || '').toLowerCase().trim()] || '';
}

function runNiriAction(args) {
  const res = spawnSync('niri', ['msg', 'action', ...args], {
    encoding: 'utf8',
    timeout: 4000,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || `niri salió con código ${res.status}`).trim());
  }
}

function manage(action, target) {
  const act = normalizeAction(action);
  const tgt = String(target ?? '').trim();

  if (!act) {
    return { ok: false, error: `Acción no soportada: ${action}` };
  }
  if (!tgt) {
    return { ok: false, error: `Falta el parámetro target para la acción "${action}".` };
  }

  try {
    if (process.platform === 'linux') {
      if (act === 'spawn') {
        runNiriAction(['spawn', '--', tgt]);
        return { ok: true, message: `Aplicación "${tgt}" lanzada en Niri.` };
      }
      if (act === 'focus') {
        runNiriAction(['focus-window', '--id', tgt]);
        return { ok: true, message: `Ventana ${tgt} enfocada en Niri.` };
      }
      if (act === 'close') {
        runNiriAction(['focus-window', '--id', tgt]);
        runNiriAction(['close-window']);
        return { ok: true, message: `Ventana ${tgt} cerrada en Niri.` };
      }
      if (act === 'workspace') {
        runNiriAction(['focus-workspace', tgt]);
        return { ok: true, message: `Workspace cambiado a ${tgt} en Niri.` };
      }
    }

    if (process.platform === 'win32') {
      const psScript = path.join(__dirname, '..', '..', 'scripts', 'windows.ps1');
      if (fs.existsSync(psScript)) {
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" ${act} "${tgt}"`, {
          encoding: 'utf8',
          timeout: 5000,
        });
        return { ok: true, message: `Acción "${act}" ejecutada sobre "${tgt}" en Windows.` };
      }

      if (act === 'spawn') {
        execSync(`powershell -NoProfile -Command "Start-Process '${tgt.replace(/'/g, "''")}'"`, { timeout: 4000 });
        return { ok: true, message: `Programa "${tgt}" iniciado en Windows.` };
      }
      if (act === 'close') {
        execSync(`taskkill /PID ${Number(tgt) || tgt} /F`, { timeout: 4000 });
        return { ok: true, message: `Ventana/proceso ${tgt} cerrado en Windows.` };
      }
      if (act === 'focus') {
        execSync(
          `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).AppActivate(${Number(tgt) || `'${tgt.replace(/'/g, "''")}'`})"`,
          { timeout: 4000 }
        );
        return { ok: true, message: `Ventana ${tgt} enfocada en Windows.` };
      }
      if (act === 'workspace') {
        return { ok: false, error: 'El cambio de workspace por CLI requiere scripts/windows.ps1 en Windows.' };
      }
    }

    return { ok: false, error: `Plataforma no soportada: ${process.platform}` };
  } catch (err) {
    console.warn('[capri:windows] Error en manage:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { startWindowWatch, getWindows, manage };
