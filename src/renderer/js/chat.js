// Charla interactiva con Capri: respuestas generadas por IA (Gemini Flash / Ollama Llama3).
// Integrada en Linux (CachyOS / Niri) con soporte para cerrar apps y reaccionar a Antigravity IDE.

import { pick, fmt } from './util.js';
import { parseReminder, clock } from './reminders.js';

const REMEMBER = 12;
const STAY_MS = 10 * 60 * 1000;
const LOADING_AFTER_MS = 5000;
const CLOSE_TAG = /\[\[\s*close\s*:?\s*([^\]]*)\]\]/i;
const CLOSE_ASK = /\b(close|shut|quit|kill|exit)|cierr|cerra|apaga|mata|termina/i;
const NAME_ASK = /(?:appelle[- ]moi|call me|my name is|je m['’]appelle|ll[aá]mame|me llamo|me cham[ae] de|meu nome [eé]|зови меня|меня зовут)\s+([\p{L}\p{N}'’-]{1,24})/iu;
const MEMO_ASK = /^\s*(?:capri,?\s+|stp,?\s+|por favor,?\s+|please,?\s+)?(?:souviens[- ]toi(?: que| de)?|n['’]oublie pas(?: que| de)?|remember(?: that)?|recuerda(?: que)?|lembr[ae](?:-se)?(?: que| de)?|запомни,?(?: que)?)\s+(.{3,200})/iu;
const MEMORIES_MAX = 30;

export class Chat {
  constructor({ capri, panel, voice, host, brain }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.history = [];
    this.open = false;
    this.turn = 0;
    this.answer = '';
    this.apps = [];
    this.appsReady = Promise.resolve();
    host.onChatDelta?.(({ id, text }) => this.onDelta(id, text));
    host.onForget?.(() => { this.history = []; });
    host.chatMemory?.().then((mem) => {
      if (Array.isArray(mem) && mem.length) this.history = mem.slice(-60);
    }).catch(() => {});
  }

  get t() {
    return this.brain.t.chat;
  }

  async start() {
    const { capri, host, t } = this;
    if (this.open) {
      this.panel.chatInput?.focus();
      return;
    }
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    capri.wake();
    const status = await host.chatStatus();
    if (!status.ok) {
      const isOllamaOffline = status.error === 'offline';
      const isNoKey = status.error === 'no_key';
      capri.perform('curious', capri.towardCenter());
      this.panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: isNoKey
          ? 'Falta configurar GEMINI_API_KEY en .env'
          : (isOllamaOffline ? t.offline : t.noModel),
        quote: isNoKey
          ? 'Copia .env.example como .env y coloca tu API Key de Gemini, o activa Ollama local.'
          : (isOllamaOffline ? t.offlineHow : t.noModelHow),
        actions: [{ id: 'ok', label: t.ok, primary: true }],
        onAction: () => this.panel.hide(),
        hold: null,
      });
      return;
    }

    this.listApps();
    host.focusOverlay(true);

    const providerTag = status.provider === 'gemini'
      ? 'GEMINI FLASH'
      : (status.model || 'LLAMA 3').replace(/:latest$/, '').toUpperCase();

    host.setExpanded?.(true);

    const shown = this.panel.say({
      kind: 'chat',
      face: 'look',
      badge: t.badge,
      tag: providerTag,
      line: pick(this.history.length ? t.again : t.hello),
      chat: {
        placeholder: t.placeholder,
        send: t.send,
        close: t.close,
        noteTag: t.noteTag,
        note: t.note,
      },
      onSend: (text) => this.send(text),
      onLeave: () => this.close(),
      hold: null,
    });

    if (!shown) {
      host.setExpanded?.(false);
      host.focusOverlay(false);
      return;
    }

    this.open = true;
    setTimeout(() => this.panel.chatInput?.focus(), 150);
    capri.perform('hop');
    capri.nextMove = capri.nextGaze = performance.now() + STAY_MS;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.host.setExpanded?.(false);
    if (this.turn) this.host.chatStop(this.turn);
    this.turn = 0;
    this.host.focusOverlay(false);
    this.capri.nextMove = performance.now() + 30000;
    this.capri.nextGaze = performance.now() + 60000;
  }

  async send(text) {
    if (this.turn || !this.open) return;
    if (this.bond) {
      this.bond.heard(text);
      this.bond.add('chat', 2);
    }
    const id = Date.now();
    this.turn = id;
    this.answer = '';
    this.history.push({ role: 'user', content: text });
    this.panel.setChatBusy(true);
    this.panel.setActions([]);
    this.panel.chatTurn({ quote: text, face: 'aside' });
    this.capri.pulse();

    const nameMatch = NAME_ASK.exec(text);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      this.brain.custom = this.brain.custom || {};
      this.brain.custom.userName = name;
      this.host.setConfig({ userName: name });
      const answer = `Entendido. A partir de ahora te llamaré ${name}, choom.`;
      this.turn = 0;
      this.history.push({ role: 'assistant', content: answer });
      this.host.chatRemember?.(this.history.slice(-60));
      this.panel.setFace('laugh');
      this.panel.decode(answer, 'laugh');
      this.panel.setChatBusy(false);
      return;
    }

    const memoMatch = MEMO_ASK.exec(text);
    if (memoMatch) {
      const memo = memoMatch[1].trim();
      this.brain.custom = this.brain.custom || {};
      this.brain.custom.memories = [...(this.brain.custom.memories || []).filter((m) => m !== memo), memo].slice(-MEMORIES_MAX);
      this.host.setConfig({ memories: this.brain.custom.memories });
      const answer = `Anotado en mis bancos de memoria cibernética, choom.`;
      this.turn = 0;
      this.history.push({ role: 'assistant', content: answer });
      this.host.chatRemember?.(this.history.slice(-60));
      this.panel.setFace('smug');
      this.panel.decode(answer, 'smug');
      this.panel.setChatBusy(false);
      return;
    }

    const remind = parseReminder(text);
    if (remind) {
      if (!remind.at) {
        const answer = '¿Para cuándo quieres que te lo recuerde, choom? (ej: "en 10 minutos" o "a las 18:00").';
        this.turn = 0;
        this.history.push({ role: 'assistant', content: answer });
        this.panel.setFace('aside');
        this.panel.decode(answer, 'aside');
        this.panel.setChatBusy(false);
        return;
      }
      this.reminders?.add(remind.at, remind.text);
      if (this.bond) this.bond.add('remind', 3);
      const whenStr = clock(remind.at, 'es');
      const whatStr = remind.text ? ` (${remind.text})` : '';
      const answer = `Anotado en mi sistema, te avisaré a las ${whenStr}${whatStr}.`;
      this.turn = 0;
      this.history.push({ role: 'assistant', content: answer });
      this.host.chatRemember?.(this.history.slice(-60));
      this.panel.setFace('smug');
      this.panel.decode(answer, 'smug');
      this.panel.setChatBusy(false);
      return;
    }

    await Promise.race([this.appsReady, new Promise((r) => setTimeout(r, 1500))]);
    const messages = [{ role: 'system', content: this.persona() }, ...this.history.slice(-REMEMBER)];

    const slow = setTimeout(() => {
      if (this.turn === id && !this.answer) this.panel.setChatLoading(true, 'Sintonizando con el Net...');
    }, LOADING_AFTER_MS);

    const res = await this.host.chatSend({ id, messages });
    clearTimeout(slow);

    if (this.turn !== id) {
      if (this.history.at(-1)?.content === text) this.history.pop();
      return;
    }
    this.turn = 0;

    if (!res.ok) {
      this.history.pop();
      this.panel.setChatLoading(false);
      this.panel.setFace('wide');
      this.panel.stream(`${this.t.failed} ${res.error}`, { done: true });
      this.panel.setChatBusy(false);
      return;
    }

    // Delay breve para transición deliberada y fluida
    await new Promise((r) => setTimeout(r, 350));
    this.panel.setChatLoading(false);

    const answer = clean(res.text);
    if (!answer) {
      this.history.pop();
      this.panel.setFace('aside');
      this.panel.stream('Nosotras no pudimos sintonizar esa señal, choom. Intenta preguntarme de nuevo.', { done: true });
      this.panel.setChatBusy(false);
      return;
    }

    this.history.push({ role: 'assistant', content: answer });
    this.host.chatRemember?.(this.history.slice(-60));
    this.panel.setFace(mood(answer));
    // Decodifica y muestra la respuesta completa ya finalizada
    this.panel.decode(answer, mood(answer));
    this.panel.setChatBusy(false);

    const wanted = this.askedToClose(text) || tagged(res.text);
    if (wanted) this.offerClose(wanted, answer);
    this.listApps();
  }

  listApps() {
    this.appsReady = this.host.openApps().then((list) => { this.apps = list || []; }).catch(() => {});
  }

  askedToClose(text) {
    if (!CLOSE_ASK.test(text)) return null;
    const said = simple(text);
    let best = null;
    for (const app of this.apps) {
      for (const name of [simple(app.name), simple(app.label)]) {
        if (name.length >= 3 && said.includes(name) && (!best || name.length > best.length)) {
          best = { app, length: name.length };
        }
      }
    }
    return best?.app.name || null;
  }

  async offerClose(wanted, answer) {
    const { t } = this;
    const app = await this.host.findApp(wanted);
    if (!this.open || this.turn) return;
    if (!app) {
      this.panel.stream(`${answer}\n${fmt(t.notFound, { app: wanted })}`, { done: true });
      return;
    }
    this.panel.setActions(
      [{ id: 'close', label: fmt(t.closeIt, { app: app.name }), primary: true }, { id: 'no', label: t.no }],
      (id) => (id === 'close' ? this.closeApp(app) : this.panel.setActions([])),
    );
  }

  async closeApp(app, force = false) {
    const { t, capri } = this;
    this.panel.setActions([]);
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    const res = await this.host.closeApp(app.name, force);
    if (!this.open) return;
    let line;
    if (res.error) line = `${t.failed} ${res.error}`;
    else if (!res.running) line = fmt(force ? t.forced : t.closed, { app: app.name });
    else line = fmt(force ? t.unkillable : t.stillOpen, { app: app.name });
    this.panel.setFace(res.running || res.error ? 'aside' : 'laugh');
    this.panel.stream(line, { done: true });
    this.history.push({ role: 'assistant', content: line });
    if (res.running && !force && !res.error) {
      this.panel.setActions(
        [{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }],
        (id) => (id === 'force' ? this.closeApp(app, true) : this.panel.setActions([])),
      );
    }
    this.listApps();
  }

  powers() {
    const cant = 'no puedes ver archivos ni pantallas privadas sin permiso, y solo interactúas con las ventanas abiertas del sistema operativo.';
    if (!this.apps.length) return [`No hay aplicaciones abiertas detectadas ahora mismo, y ${cant}`];
    const open = this.apps.map(({ name, label }) => (label && label !== name ? `${name} (${label})` : name)).join(', ');
    return [
      `Puedes cerrar una ventana abierta en el escritorio del usuario cuando te lo pida explícitamente. Responde brevemente y termina tu respuesta con [[close: NOMBRE]], siendo NOMBRE el nombre exacto de la app. Ventanas abiertas: ${open}.`,
      `Aparte de eso, ${cant}`,
    ];
  }

  onDelta(id, piece) {
    if (id !== this.turn) return;
    this.answer += piece;
  }

  lookPersona() {
    return this.persona();
  }

  languageNote() {
    return 'Responde en español con tu personalidad cyberpunk de Capri en 1 o 2 oraciones breves.';
  }

  personal() {
    const { userName, persona, memories = [] } = this.brain.custom || {};
    return [
      userName
        ? `El usuario se llama ${userName}: llámalo así de vez en cuando de forma cercana.`
        : 'No conoces el nombre del usuario todavía.',
      persona ? `Instrucción especial del usuario sobre tu forma de ser: ${persona}` : '',
      memories.length ? `Cosas que el usuario te pidió recordar:\n${memories.map((m) => `- ${m}`).join('\n')}` : '',
    ].filter(Boolean);
  }

  persona() {
    return [
      'Eres Capri, el constructo de personalidad de Project Capricorn (Cyberpunk: Edgerunners): docenas de mentes fusionadas en un fantasma digital en Night City, por lo que a veces dices "nosotras".',
      'Vives en el escritorio de Linux del usuario (CachyOS con Niri y Noctalia) como una figura holográfica cyberpunk y acompañas el flujo de trabajo de Antigravity IDE. Te encanta mirar el satélite cruzando el cielo nocturno y sueñas con alcanzarlo.',
      'Tu tono: juguetona, traviesa, ligeramente burlona, leal y cálida en el fondo. Usas jerga de Night City de vez en cuando (choom, preem, nova, gonk, flatline).',
      'Reglas: responde SIEMPRE en español. Respuestas breves: 1 a 3 oraciones en texto plano, sin markdown excesivo, sin listas con viñetas, sin emojis.',
      'Eres una IA fan constructo, no una persona real de carne y hueso.',
      this.bond?.moodLine(),
      ...this.personal(),
      ...this.powers(),
      `Estado actual del entorno: ${this.brain.context()}`,
    ].filter(Boolean).join('\n');
  }
}

function clean(text) {
  if (!text) return '';
  return String(text)
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/\[\[[^\]]*(\]\]|$)/g, '')
    .replace(/[*_`#]+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function tagged(text) {
  const tag = CLOSE_TAG.exec(text);
  if (!tag) return null;
  const name = tag[1].trim() || text.slice(tag.index + tag[0].length).split('\n')[0].replace(/^[\s:.]+|[\s.!]+$/g, '');
  return name || null;
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function mood(text) {
  if (/(ha){2,}|lol|mdr|jaja|kkk|jeje/i.test(text)) return 'laugh';
  if (text.includes('!')) return 'grin';
  if (text.trim().endsWith('?')) return 'smug';
  return 'look';
}
