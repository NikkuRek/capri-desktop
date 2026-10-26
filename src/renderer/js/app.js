import { Capri } from './capri.js';
import { FxLayer, GRAB_FRAMES } from './fx.js';
import { Chip, Mask } from './chip.js';
import { Panel } from './panel.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { Chat } from './chat.js';
import { LINES } from './lines.js';
import { pick } from './util.js';

const host = window.host;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// close-ups of her for the cut-ins, frames of the show (tools/build-cutins.py)
const CUTINS = ['grin', 'laugh', 'eyes', 'many', 'look'];

async function boot() {
  const [config, image, intro, ...cutins] = await Promise.all([
    host.getConfig(),
    loadImage('../../assets/capri/capri-full.png'),
    // her intro: her close-up grabbing the screen, and its drawings with her mouth and arm moving
    Promise.all(GRAB_FRAMES.map((name) => loadImage(`../../assets/capri/intro-${name}.webp`).catch(() => null)))
      .then((cels) => Promise.all(cels.map((cel) => cel && createImageBitmap(cel))))
      .then((cels) => (cels[0] ? Object.fromEntries(GRAB_FRAMES.map((name, i) => [name, cels[i]])) : null)),
    ...CUTINS.map((name) => loadImage(`../../assets/capri/cutin-${name}.png`)),
    document.fonts.load('600 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);
  document.documentElement.lang = config.lang;

  const fx = new FxLayer(document.getElementById('fx'), {
    cutins: Object.fromEntries(CUTINS.map((name, i) => [name, cutins[i]])),
    intro,
  });
  fx.resize(innerWidth, innerHeight);
  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight);
  const mask = new Mask(document.getElementById('mask'));

  const voice = new Voice();
  voice.configure(config);
  host.listSounds().then((list) => list.length && voice.loadCustom(list));

  const panel = new Panel({
    panel: document.getElementById('panel'),
    ticker: document.getElementById('ticker'),
    labels: LINES[config.lang] || LINES.es || LINES.fr,
  });

  const capri = new Capri({
    root: document.getElementById('capri'),
    canvas: document.getElementById('sprite'),
    image,
    fx,
    voice,
  });
  capri.wander = config.wander;
  capri.possessWindows = config.possess;
  capri.setScale(config.scale);

  const brain = new Brain({ capri, panel, voice, host, lang: config.lang });
  const chat = new Chat({ capri, panel, voice, host, brain });

  // Click-through everywhere except on her body, the panel and her biochip.
  let interactive = false;
  let mouse = null;
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));

  const updateHitRects = () => {
    if (capri.dragging) return;
    const rects = [];
    const cr = capri.rect();
    if (cr) rects.push(cr);
    const chr = chip.rect();
    if (chr) rects.push(chr);
    const mr = mask.rect();
    if (mr) rects.push(mr);
    const pr = panel.rect();
    if (pr) rects.push({ x: Math.round(pr.left), y: Math.round(pr.top), width: Math.round(pr.width), height: Math.round(pr.height) });
    host.setHitRects?.(rects);
  };

  const refreshHit = () => {
    if (capri.dragging) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    document.body.style.cursor = onChip() ? 'pointer' : '';
    return setInteractive(Boolean(onPanel || capri.hit(mouse.x, mouse.y) || onChip()));
  };

  let wakeTimer = 0;
  const comeOut = () => {
    if (capri.stowed) host.setConfig({ visible: true });
    capri.unstow();
  };
  const hoverChip = () => {
    chip.pointer = chip.visible && mouse && chip.contains(mouse.x, mouse.y) ? mouse : null;
    const near = mask.visible && mouse && mask.contains(mouse.x, mouse.y, 30);
    mask.pointer = near ? mouse : null;
    if (!near) {
      clearTimeout(wakeTimer);
      wakeTimer = 0;
    } else if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = 0;
        if (capri.dormant) capri.wake();
      }, 400);
    }
  };

  window.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
    updateHitRects();
  });
  document.addEventListener('mouseleave', () => {
    mouse = null;
    refreshHit();
    hoverChip();
    updateHitRects();
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    host.openMenu();
  });
  window.addEventListener('click', (e) => {
    if (chip.visible && (chip.contains(e.clientX, e.clientY, 8) || config.compact)) comeOut();
  });

  // wiring
  capri.onMove = (head) => {
    panel.setAnchor({ ...head, lean: capri.pointing ? -capri.pointing.dir : 0 }, capri.view);
    refreshHit();
    updateHitRects();
  };
  capri.onTeleport = (phase) => {
    if (phase === 'start') panel.suspend();
    else panel.resume();
    updateHitRects();
  };
  capri.chipAt = () => chip.center();
  capri.onStow = () => {
    chip.setMode(capri.mode);
    chip.show();
    updateHitRects();
  };
  capri.onUnstow = () => {
    chip.hide();
    updateHitRects();
  };
  updateHitRects();
  setInterval(updateHitRects, 100);
  setTimeout(updateHitRects, 200);

  capri.onDoze = (phase, face) => {
    if (phase === 'start') {
      mask.place(face.x, face.y, capri.scale * 1.1);
      mask.show();
    } else if (phase === 'waking') {
      mask.wake();
    } else {
      mask.hide();
    }
  };
  capri.onMode = (mode, prev) => chip.setMode(mode, prev);
  capri.onGaze = (when) => {
    const lines = when === 'end' ? brain.t.uplink : brain.t.gaze;
    if (!panel.visible && Math.random() < (when === 'end' ? 0.6 : 0.4)) {
      panel.say({ kind: 'info', line: pick(lines), hold: 3800 });
    }
  };

  capri.onClick = () => {
    if (panel.visible) panel.hide();
    else brain.status();
  };
  panel.onChar = (kind) => voice.play('blip', { mood: kind });
  panel.onTalk = (talking) => talking && capri.perform('talk');
  capri.onMenu = () => host.openMenu();

  host.onWindows((data) => {
    capri.setWindows(data);
    brain.onWindows(data);
  });
  host.windowsNow().then((data) => data && capri.setWindows(data));
  host.onIdeEvent?.((event) => brain.onIdeEvent(event));

  const updateLayout = (width, height) => {
    fx.resize(width, height);
    chip.place(width, height, { center: Boolean(config.compact) });
    capri.setView(width, height);
    if (config.compact) {
      capri.pos.x = Math.round(width / 2);
      capri.pos.y = height - 16;
      capri.place();
    }
    updateHitRects();
  };

  host.onResize(({ width, height }) => updateLayout(width, height));
  window.addEventListener('resize', () => updateLayout(innerWidth, innerHeight));

  host.onConfig((cfg) => {
    const wasCompact = config.compact;
    const wasScale = config.scale;
    config = { ...config, ...cfg };
    voice.configure(cfg);
    capri.wander = cfg.compact ? false : cfg.wander;
    capri.possessWindows = cfg.compact ? false : cfg.possess;
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
    if (cfg.compact !== wasCompact || cfg.scale !== wasScale) {
      updateLayout(innerWidth, innerHeight);
    }
    if (cfg.mode === 'only-view' && chat.open) {
      chat.close();
    }
    if (cfg.lang !== brain.lang) {
      brain.lang = cfg.lang;
      panel.labels = LINES[cfg.lang] || LINES.es || LINES.fr;
      document.documentElement.lang = cfg.lang;
    }
  });

  host.onCommand(async (cmd) => {
    switch (cmd.name) {
      case 'teleport':
        capri.teleport(capri.spot('random'));
        break;
      case 'chat':
        if (config.mode !== 'only-view') {
          chat.start();
        }
        break;
      case 'status':
        brain.status();
        break;
      case 'stow':
        if (cmd.on) capri.stow();
        else capri.unstow();
        break;
      case 'satellite':
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (capri.stance === 'peek') await capri.unpeek();
        if (!capri.gaze({ big: true })) setTimeout(() => capri.gaze({ big: true }), 1500);
        break;
      case 'possess':
        if (capri.stowed) await capri.unstow();
        capri.wake();
        if (capri.stance === 'sit' && capri.canPossess()) {
          capri.possess();
        } else {
          const seat = capri.pickSeat();
          if (seat) {
            await capri.sitOn(seat);
            setTimeout(() => capri.possess(), 800);
          } else {
            capri.perform('split');
          }
        }
        break;
      case 'celebrate':
        if (capri.stowed) await capri.unstow();
        capri.wake();
        panel.hide();
        await capri.teleport(capri.spot('stage'));
        capri.celebrate({
          onSpeak: () => {
            const pool = brain.t.done || ['¡Victoria! Preem.', 'Terminé. C’est preem.'];
            panel.say({ kind: 'done', line: pick(pool), hold: 7000 });
          },
        });
        break;
      case 'sleep':
        if (capri.dormant) {
          capri.wake();
        } else {
          capri.setMode('sleep');
          setTimeout(() => capri.doze(), 1500);
        }
      case 'intro':
        if (capri.stowed) await capri.unstow();
        capri.wake();
        panel.hide();
        await capri.intro(capri.spot('post'));
        break;
    }
  });

  // initial entrance: her face grabs the screen edges, says hi, and dives down
  if (config.compact) {
    updateLayout(innerWidth, innerHeight);
  }
  if (config.visible === false) {
    capri.stowNow();
  } else if (intro && !config.compact) {
    await capri.intro(capri.spot('post'));
  } else {
    await capri.materialize(capri.spot('post'));
  }
}

boot().catch((err) => console.error('[capri] boot error:', err));
