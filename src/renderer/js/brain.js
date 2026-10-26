// Autonomous personality driver for Capri (Linux CachyOS / Niri).
// Manages desktop pet interactions, Antigravity IDE events, and autonomous reflections.

import { LINES } from './lines.js';
import { pick, rand } from './util.js';

export class Brain {
  constructor({ capri, panel, voice, host, lang = 'es' }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.lang = lang;
    this.idleTimer = null;
    this.ideActivity = {
      project: 'capri-desktop',
      status: 'idle',
      lastAction: null,
      actionsCount: 0,
      startTime: null,
    };
    this.startAutonomousLife();
  }

  get t() {
    return LINES[this.lang] || LINES.es;
  }

  say(kind, line, extra = {}) {
    return this.panel.say({ kind, line, ...extra });
  }

  context() {
    if (this.ideActivity.status === 'working') {
      const act = this.ideActivity.lastAction ? `, última acción: ${this.ideActivity.lastAction}` : '';
      return `Antigravity IDE está trabajando en ${this.ideActivity.project} (${this.ideActivity.actionsCount} acciones realizadas${act}).`;
    }
    return 'Antigravity IDE está en reposo o esperando una nueva tarea del usuario.';
  }

  status() {
    if (this.capri.stowed) return;
    if (this.capri.dormant) {
      this.capri.wake();
      return;
    }

    const pool = (this.t.hello && this.t.hello.length) ? this.t.hello : (this.t.idle || []);
    const line = pick(pool) || 'Construct Capricorn en línea.';
    const faces = ['calm', 'smug', 'aside', 'wide'];
    this.say('idle', line, { face: pick(faces), hold: 4500 });
    this.voice.play('tick');

    const tricks = ['spin', 'curious', 'hop', 'split', 'look'];
    this.capri.perform(pick(tricks), this.capri.towardCenter());
  }

  startAutonomousLife() {
    const scheduleNext = () => {
      this.idleTimer = setTimeout(() => {
        if (!this.capri.hidden && !this.capri.dormant && this.capri.mode === 'idle' && !this.capri.busy) {
          const r = Math.random();
          if (r < 0.4 && this.t.idle) {
            this.say('idle', pick(this.t.idle), { face: 'calm', hold: 5000 });
          } else if (r < 0.7 && this.t.gaze) {
            this.say('info', pick(this.t.gaze), { face: 'aside', hold: 5000 });
          }
        }
        scheduleNext();
      }, rand(90000, 240000));
    };
    scheduleNext();
  }

  onWindows({ fg }) {
    // Niri window tracking
  }

  onIdeEvent(event) {
    if (!event || typeof event !== 'object') return;
    const name = String(event.hook_event_name || event.event || '').toLowerCase();
    const tool = event.tool_name || event.tool || '';
    const target = event.target || event.message || '';
    const project = event.project || this.ideActivity.project;

    this.ideActivity.project = project;

    if (name === 'tool' || name === 'tooluse' || name === 'pretooluse') {
      this.ideActivity.status = 'working';
      this.ideActivity.actionsCount++;
      this.ideActivity.lastAction = `${tool} ${target}`.trim();

      const verb = (this.t.verbs && this.t.verbs[tool]) || 'Ejecuta';
      this.panel.setTicker({ verb, target: target || tool, error: false });
      this.capri.pulse();
      this.voice.play('blip');
    } else if (name === 'done' || name === 'taskdone' || name === 'stop') {
      this.ideActivity.status = 'idle';
      this.panel.setTicker(null);
      this.say('done', pick(this.t.done), { face: 'look', hold: 5000 });
      this.capri.celebrate();
    } else if (name === 'error') {
      this.panel.setTicker({ verb: 'Error', target: tool || 'Falló', error: true });
      this.say('error', (pick(this.t.error) || 'Error en {tool}').replace('{tool}', tool || 'herramienta'), { face: 'wide', hold: 5000 });
      this.capri.perform('split');
      this.voice.play('shock');
    } else if (name === 'prompt' || name === 'start' || name === 'userprompt') {
      this.ideActivity.status = 'working';
      this.say('work', pick(this.t.prompt), { face: 'calm', hold: 4000 });
      this.capri.perform('hop');
    } else if (name === 'status' && event.message) {
      this.say('info', event.message, { face: 'calm', hold: 4000 });
    }
  }

  stop() {
    clearTimeout(this.idleTimer);
  }
}
