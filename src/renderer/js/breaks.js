// Pausas de salud: tras dos horas continuas frente al PC sin un descanso real
// (cinco minutos sin tocar el teclado ni el ratón), Capri te sugiere levantarte,
// en un momento tranquilo y nunca en medio de un juego.

import { fmt, pick } from './util.js';

const EVERY = 2 * 60 * 60 * 1000;
const REAL_BREAK = 5 * 60;          // segundos sin actividad que cuentan como descanso
const AGAIN = 30 * 60 * 1000;       // "más tarde" o sin respuesta
const CHECK = 60 * 1000;

export class Breaks {
  constructor({ host, panel, brain, capri, pc, quiet }) {
    Object.assign(this, { host, panel, brain, capri, pc, quiet });
    this.enabled = true;
    this.since = Date.now();
    this.due = this.since + EVERY;
    setInterval(() => this.check(), CHECK);
  }

  get t() {
    return this.brain.t.breaks;
  }

  async check() {
    const idle = await this.host.pcIdle().catch(() => 0);
    if (idle >= REAL_BREAK) {
      // descanso tomado
      this.since = Date.now() - idle * 1000;
      this.due = Date.now() + EVERY;
      return;
    }
    if (!this.enabled || Date.now() < this.due || this.pc?.game || !this.quiet?.()) return;
    this.due = Date.now() + AGAIN;
    this.remind();
  }

  remind() {
    const { t } = this;
    if (!t) return;
    const minutes = Math.round((Date.now() - this.since) / 60000);
    const time = fmt(t.time || '{h} h {m}', { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') });
    this.capri.wake();
    this.capri.perform('hop');
    this.panel.say({
      kind: 'info',
      face: 'look',
      line: fmt(pick(t.lines), { time }),
      hold: 20000,
      actions: [{ id: 'pause', label: t.pause, primary: true }, { id: 'later', label: t.later }],
      onAction: (id) => {
        if (id === 'later') {
          this.due = Date.now() + AGAIN;
          this.panel.say({ kind: 'info', face: 'aside', line: t.laterLine, hold: 3500 });
          return;
        }
        this.panel.say({ kind: 'done', face: 'smug', line: pick(t.paused), hold: 4000 });
      },
    });
  }
}

