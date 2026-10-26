'use strict';

// Feeds the overlay with the position of the other windows (Windows only), so Capri can
// sit on them. A small PowerShell helper does the Win32 calls; we turn its physical pixels
// into the overlay's coordinates.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { screen } = require('electron');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startNiriWatch({ overlay, onUpdate }) {
  let child = null;
  let stopped = false;
  let cachedWindows = [];
  let cachedWorkspaces = [];
  let computeTimer = null;

  function getOutputs() {
    try {
      const { execSync } = require('node:child_process');
      const raw = execSync('niri msg --json outputs', { encoding: 'utf8', timeout: 2000 });
      const parsed = JSON.parse(raw);
      const firstKey = Object.keys(parsed)[0];
      return parsed[firstKey]?.logical || { width: 1920, height: 1080 };
    } catch {
      return { width: 1920, height: 1080 };
    }
  }

  const output = getOutputs();
  const screenW = output.width;
  const screenH = output.height;

  function compute() {
    if (overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();

    const activeWs = cachedWorkspaces.find((w) => w.is_active);
    if (!activeWs) return;

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
  };

  start();
  return {
    stop() {
      stopped = true;
      clearTimeout(computeTimer);
      child?.kill();
    },
  };
}

function startWindowWatch({ overlay, onUpdate }) {
  if (process.platform === 'linux') {
    const { spawnSync } = require('node:child_process');
    try {
      if (process.env.NIRI_SOCKET || spawnSync('which', ['niri']).status === 0) {
        return startNiriWatch({ overlay, onUpdate });
      }
    } catch {
      // not niri
    }
    return { stop() {} };
  }

  if (process.platform !== 'win32') return { stop() {} };

  let child = null;
  let stopped = false;
  let restarts = 0;

  const handle = overlay.getNativeWindowHandle();
  const self = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  const toOverlay = (win, bounds) => {
    const dip = screen.screenToDipRect(null, { x: win.x, y: win.y, width: win.w, height: win.h });
    return { id: win.id, x: dip.x - bounds.x, y: dip.y - bounds.y, w: dip.width, h: dip.height, max: win.max };
  };

  const start = () => {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, String(self), String(process.pid),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let snap;
      try {
        snap = JSON.parse(line);
      } catch {
        return;
      }
      if (overlay.isDestroyed()) return;
      const bounds = overlay.getBounds();
      const wins = snap.wins
        .map((w) => toOverlay(w, bounds))
        // only what overlaps Capri's screen
        .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
      onUpdate({ fg: snap.fg, wins });
    });
    child.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 3) setTimeout(start, 3000);
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
  };
}

module.exports = { startWindowWatch };
