// Talking to her: you type in her panel, and a model (setup.js picks which) answers as her, in
// writing. The replies are AI-generated, and the panel says so on every chat.
// She can do a few things on your PC when you ask (Windows): open an app or a game, play music or
// control what's playing, open a website, close an app. She spots what you want in what you wrote,
// or the model asks for it with a tag in its answer. Music right away; an app you named yourself
// right away; anything only the model asked for, a website, and closing an app behind a button.

import { pick, fmt } from './util.js';
import { ASSISTANT_NAMES } from './lines.js';
import { parseReminder, parseWhen, clock } from './reminders.js';
import { VoiceRecognition } from './voice-recognition.js';

const REMEMBER = 20; // messages she has in mind when answering
const KEEP = 60;     // messages she remembers across restarts (memory.json)
const LANG_LAST = 'Escribe todo en español. Solo las palabras de jerga de Night City se quedan en inglés, nunca una frase entera.';
const LANG_NOW = 'Responde siempre en español.';
const STAY_MS = 10 * 60 * 1000; // no wandering off mid-conversation
const LOADING_AFTER_MS = 5000;
const CLOSE_TAG = /\[\[\s*close\s*:?\s*([^\]]*)\]\]/i; // [[close: AM Music]] al final de su respuesta
const CLOSE_ASK = /\b(cierra|cerrar|termina|mata|salir|close|quit|kill)\b/i;
// etiquetas de acción: [[open: Spotify]], [[music: Bad Bunny]], [[media: next]], [[site: youtube.com]], [[run: htop]]
const TAG = /\[\[\s*(open|music|media|site|run|cmd)\s*:\s*([^\]]*)\]\]/i;
const OPEN_ASK = /\b(abre|abrir|inicia|iniciar|ejecuta|ejecutar|corre|correr|lanza|lanzar|open|launch|start|run)\b/i;
const DEV_ASK = /\b(?:agy|antigravity|proyectos?|wofi)\b/i;
const ACTION_ASK = /\b(?:actualiza|actualizar|update|upgrade|conecta|conectar|connect|desconecta|desconectar|limpia|limpiar|limpieza|libera|liberar|prune|optimiza|optimizar|rdp|tailscale|lazygit|yazi|fastfetch|btop|htop|neovim|nvim|cachy|cachyos)\b/i;
const AI_CMD_ASK = /^(?:ejecuta|corre|exec|run|comando|terminal)\s*[:]/i;
const TASKS_MD_ASK = /(?:crea|haz|genera|escribe|crear|hacer|generar|guarda|guardar)\s+(?:un\s+)?(?:documento|archivo|lista)?\s*(?:md|markdown|de\s+tareas|con\s+las?\s+tareas?|tasks?)/i;
const TASKS_MD_SHORT = /(?:documento|archivo)\s+md|lista\s+de\s+tareas|(?:tareas?|tasks?)\s+en\s+md/i;
// control de música
const MEDIA_ASK = [
  ['pause', /\b(pausa|pausar|pause|detén|detener|para la música)\b/i],
  ['next', /\b(siguiente|próxima|proxima|salta|saltar|next|skip)\b/i],
  ['previous', /\b(anterior|previa|atrás|previous)\b/i],
  ['play', /\b(reanuda|reanudar|continúa|continuar|resume|pon la música)\b/i],
  ['volup', /sube (?:el )?volumen|más fuerte|sube la música/i],
  ['voldown', /baja (?:el )?volumen|más bajo|baja la música/i],
  ['mute', /\b(silencio|silencia|silenciar|mute|mutea)\b/i],
];
const MUSIC_WORD = /m[úu]sica|canci[óo]n|canciones|tema|pista|spotify/i;
const SPOTIFY_ASK = /(?:pon|poner|toca|tocar|reproduce|reproducir|escucha|escuchar|play)\s+(?:me\s+)?(.+?)\s+en\s+spotify/i;
const MEDIA_ACTIONS = new Set(MEDIA_ASK.map(([action]) => action));
const YOUTUBE_ASK = /(?:pon|poner|toca|tocar|reproduce|reproducir|escucha|escuchar|play)(?:me)?\s+(.+?)\s+en\s+youtube/i;
const PLAY_ASK = /^(?:capri,?\s+)?(?:pon|poner|toca|tocar|reproduce|reproducir|play)(?:me)?\s+(.{2,100})$/iu;
const GAME_ASK = /^(?:capri,?\s+)?(?:juega|jugar|quiero jugar)\s+(?:a\s+)?/i;
const songOf = (s) => s
  .replace(/^(?:la |una )?(?:m[úu]sica|canci[óo]n|tema|pista)\s+(?:de )?/i, '')
  .replace(/^(?:algo de |un poco de |del |de )\s*/i, '')
  .replace(/\s+en\s+youtube\s*$/i, '')
  .trim();
const PLAY_AFTER = /\sy\s+(?:pon|toca|reproduce|escucha|abre|inicia|lanza)(?:me)?\s+(.{2,100})$/i;
const MUSIC_START = /^(?:capri,?\s+)?(?:inicia|pon|toca|escucha)(?:me)?\s+(?:la |una )?(?:m[úu]sica|canci[óo]n)\s+(.{2,100})$/i;
const HER_PICK = /lo que quieras|tu elecci[óo]n|sorpr[eé]ndeme|como quieras|pon lo que sea/i;
const VAGUE_SONG = /^(?:(?:algo\s+de|un\s+poco\s+de|la|una|un)\s+)?(?:m[úu]sica|canci[óo]n|algo)?\s*[.!?]*$/iu;
const SEARCH_VERB = /(?:busca|buscar|encuentra|encontrar|d[óo]nde est[áa]n?)/i;
const FILE_WORD = /archivo|carpeta|documento|foto|imagen|v[íi]deo|\bpdf\b|\.\w{2,4}\b|en mi (?:pc|ordenador|computador|compu)|en mis archivos/i;
const WEB_WORD = /google|internet|\bla web\b|en l[íi]nea|online/i;
const SHOT_ASK = /captura de pantalla|pantallazo|screenshot/i;

// Ajustes del PC (system.js)
const SETTINGS_WORD = /configuraci[óo]n|ajustes|preferencias/i;
const SETTINGS_PAGES = [
  ['bluetooth', /bluetooth/i],
  ['wifi', /wi-?fi|wlan/i],
  ['update', /actualizaci[oó]n|actualizar|updates?/i],
  ['notifications', /notificaciones?/i],
  ['background', /fondo de pantalla|wallpaper/i],
  ['storage', /almacenamiento|espacio/i],
  ['mouse', /rat[oó]n|\bmouse\b/i],
  ['battery', /bater[ií]a/i],
  ['power', /energ[ií]a/i],
  ['display', /pantalla|monitor/i],
  ['network', /\bred\b|internet/iu],
  ['sound', /sonido|audio/i],
];
const INFO_ASK = [
  ['battery', /bater[ií]a/i],
  ['disk', /espacio|\bdisco\b|almacenamiento/i],
  ['ram', /\bram\b|memoria/i],
  ['ip', /\bip\b/i],
  ['heavy', /lento|pesado|consum(?:e|iendo)|procesos?|qu[eé]\s+consume|por\s+qu[eé]\s+(?:va|est[aá])\s+lento|diagn[oó]stico/i],
];
const QUESTION = /\?|cu[aá]nt[oa]s?|\bqu[eé]\b|\bcu[aá]l\b/i;
const VOLUME_ASK = /(?:volumen|sonido)\D{0,14}?(\d{1,3})\s*(?:%|por ?ciento)?/i;
const MUTE_ASK = /\b(silencio|silencia|silenciar|mute|mutea)\b|quita el sonido/i;
const UNMUTE_ASK = /quita el silencio|activa el sonido|vuelve el sonido|desmutea|unmute/i;
const TIMER_ASK = /temporizador|cron[oó]metro|timer/i;
const SNIP_ASK = /captura (?:de )?(?:una )?(?:zona|[aá]rea|parte|regi[óo]n)/i;
const TIDY_ASK = /ordena (?:mis |las )?ventanas|minimiza (?:todo|todas(?: las ventanas)?)|muestra el escritorio/i;
const UNTIDY_ASK = /(?:devuelve|devu[eé]lveme|restaura) (?:mis |las )?ventanas/i;
const PLACE_VERB = /^\s*(?:pon|coloca|mueve)\s+/i;
const SIDE = [
  ['left', /\s*(?:a la )?izquierda\b/i],
  ['right', /\s*(?:a la )?derecha\b/i],
];
const DARK_ASK = /modo oscuro|tema oscuro/i;
const LIGHT_ASK = /modo claro|tema claro/i;
const PC_WORD = /(?<![\p{L}])(?:pc|ordenador|computador|computadora|compu|equipo)(?![\p{L}])/iu;
const POWER_ASK = [
  ['cancel', /cancela (?:el )?(?:apagado|reinicio)/i],
  ['restart', /reinicia|reiniciar/i],
  ['shutdown', /\bapaga\b|apagar/i],
  ['sleep', /suspende|suspender|hiberna/i],
  ['lock', /bloquea|bloquear/i],
];

// Duración de temporizador: "10 minutos", "1h30", "45 s"
function duration(text) {
  const hm = /(\d+)\s*h\s*(\d{1,2})\b/i.exec(text);
  if (hm) return (Number(hm[1]) * 60 + Number(hm[2])) * 60000;
  let ms = 0;
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(h|horas?|min\p{L}*|m|s|seg\p{L}*)(?![\p{L}])/giu)) {
    const unit = m[2].toLowerCase();
    ms += Number(m[1].replace(',', '.')) * (/^h/.test(unit) ? 3600000 : /^m/.test(unit) ? 60000 : 1000);
  }
  if (ms) return ms;
  const when = parseWhen(text);
  return when ? Math.max(0, when.at - Date.now()) : 0;
}

// 1 h 30, 10 min, 45 s
function span(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

// Tiempo restante: 9:59, 1:02:03
function left(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const two = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}
const NOT_SEARCHED = new Set(('por favor pls puedes me el la los las un una unos unas de del en mi mis pc ordenador computador compu '
  + 'archivo archivos carpeta carpetas documento documentos foto fotos imagen imágenes video videos vídeo vídeos '
  + 'llamado llamada que se llama es son está están donde dónde busca buscar encuentra encontrar google internet web online').split(' '));
const FILE_TYPES = [
  [/after ?effects?/i, ['aep']], [/premiere/i, ['prproj']], [/photoshop|\bpsd\b/i, ['psd']], [/illustrator/i, ['ai']],
  [/blender/i, ['blend']], [/cinema ?4d|\bc4d\b/i, ['c4d']], [/fl ?studio/i, ['flp']], [/ableton/i, ['als']],
  [/\bword\b|\bdocx?\b/i, ['docx', 'doc']], [/excel|\bxlsx?\b|hoja de c[aá]lculo/i, ['xlsx', 'xls', 'csv']],
  [/powerpoint|\bpptx?\b|diapositiva/i, ['pptx', 'ppt']], [/\bpdf\b/i, ['pdf']],
  [/v[íi]deos?\b|\bmp4\b|pel[íi]culas?/i, ['mp4', 'mov', 'mkv', 'avi', 'webm']],
  [/fotos?\b|im[áa]genes?\b|\bpng\b|\bjpe?g\b/i, ['png', 'jpg', 'jpeg', 'webp', 'heic']],
  [/m[úu]sica|\bmp3\b|\baudio\b|canciones?/i, ['mp3', 'wav', 'flac', 'm4a', 'ogg']],
  [/\bzip\b|\bcomprimido|\brar\b|\b7z\b/i, ['zip', 'rar', '7z']],
];
const fileTypes = (text) => [...new Set(FILE_TYPES.filter(([re]) => re.test(text)).flatMap(([, exts]) => exts))];
const NOT_A_NAME = new Set(('y lo la los las abre abrir muestra proyecto proyectos after effect effects premiere pro photoshop illustrator blender cinema '
  + '4d c4d fl studio ableton word excel powerpoint pdf mp4 mp3 png jpg jpeg zip rar 7z película películas música audio '
  + 'presentación diapositivas último última últimos reciente recientes nuevo nueva psd docx doc xlsx pptx').split(' '));
const THEN_FOLDER = /(?:abre|abrir|muestra)\s+(?:me\s+)?(?:la )?carpeta/i;
const THEN_OPEN = /\by\s+(?:[áa]bre(?:lo|la|los|las)|abre(?:lo|la)?)\s*[.!?]*$/i;
const searched = (text) => text.replace(/^\s*capri[,!:]?\s+/i, '').toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter((w) => w && !NOT_SEARCHED.has(w)).join(' ');
const ROBLOX_VERB = /(?:^|\s)(?:juega(?:r)?(?: a)?|abre|inicia|pon|ve a)\s+/gi;
function robloxGame(text) {
  if (!/roblox/i.test(text)) return null;
  let rest = null;
  for (const m of text.matchAll(ROBLOX_VERB)) rest = text.slice(m.index + m[0].length);
  if (!rest) return null;
  const name = rest
    .replace(/\s+en\s+(?:mi\s+)?roblox\b.*$/i, '')
    .replace(/\broblox\b/ig, '')
    .replace(/^(?:a|al|el juego|un juego)\s+/i, '')
    .replace(/\s+(?:por favor|pls)\b.*$/i, '')
    .replace(/[\s.!?,]+$/, '')
    .trim();
  return name.length >= 2 ? name : null;
}
const LOOK_ASK = /mira (?:mi|la) pantalla|qu[ée] ves|mira esto|qu[ée] hay en (?:mi|la) pantalla/i;
const LISTEN = /escuch|playlist|[áa]lbum|\b(pon|toca|reproduce)\b/i;
const SOUND = /\b(sonido|volumen|audio)\b/i;
const PLAY = /\b(juega|jugar|play)\b/i;
const SITE = /\b(sitio|web|p[aá]gina|enlace|link|url)\b|\.(com|org|net|io|gg|tv|es|ai)\b/i;
const NAME_ASK = /(?:ll[aá]mame|me llamo|mi nombre es)\s+([\p{L}\p{N}'’-]{1,24})/iu;
const MEMO_ASK = /^\s*(?:capri,?\s+|por favor,?\s+)?(?:recuerda(?: que| de)?|no olvides(?: que| de)?|acu[ée]rdate(?: de)?)\s+(.{3,200})/iu;
const MEMORIES_MAX = 30;
// sites asked for by name ("open youtube") when no app on the PC goes by it: the address is hers, not
// the model's, so it opens right away like an app you named
const SITES = {
  youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com',
  twitch: 'https://www.twitch.tv', netflix: 'https://www.netflix.com', reddit: 'https://www.reddit.com',
  twitter: 'https://x.com', instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com',
  facebook: 'https://www.facebook.com', github: 'https://github.com', chatgpt: 'https://chatgpt.com',
  wikipedia: 'https://www.wikipedia.org', linkedin: 'https://www.linkedin.com', pinterest: 'https://www.pinterest.com',
  crunchyroll: 'https://www.crunchyroll.com', outlook: 'https://outlook.live.com', whatsapp: 'https://web.whatsapp.com',
  discord: 'https://discord.com/app', soundcloud: 'https://soundcloud.com', deezer: 'https://www.deezer.com',
};
// a browser named with a site ("open youtube on chrome"): the site, in the browser you use
const BROWSER = /chrome|edge|firefox|opera|brave|vivaldi|duckduckgo|browser/i;
// local models this small mostly talk nonsense ("llama3.2:1b", "qwen2.5:0.5b"…)
const TINY = /[:-](0\.5b|135m|270m|360m)\b/i;
// her face when she greets you in a mood (bond.js)
const MOOD_FACE = { angry: 'many', sulk: 'aside', dizzy: 'wide', thrown: 'wide', jealous: 'look', fun: 'laugh', happy: 'laugh', forgiven: 'smug' };

export class Chat {
  constructor({ capri, panel, voice, host, brain }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.history = []; // your chats with her, [{ role, content }], kept by main.js across restarts
    this.warm = false; // a model already answered this run (Ollama's first answer waits for it to load)
    this.open = false;
    this.turn = 0;     // id of the answer coming in, if any
    this.answer = '';
    this.apps = [];    // the apps open on this PC, as last listed: [{ name, label }]
    this.appsReady = Promise.resolve();
    this.onSetup = null; // (status) => void: she can't answer yet (app.js hands it to setup.js)
    this.onBetterModel = null; // () => void: a bigger model than the tiny one she's on (setup.js)
    this.reminders = null; // the reminders she keeps (reminders.js, from app.js)
    this.bond = null;      // how close she is to you (bond.js)
    this.jealousy = null;  // and how she takes your other AIs
    this.onMessage = null; // () => void: you said something to her
    this.waitingWhen = null; // a reminder you asked for without saying when: { text, until }
    this.voiceRec = new VoiceRecognition(host);
    this.initContinuousVoice();
    host.onChatDelta(({ id, text }) => this.onDelta(id, text));
    host.onToolStatus?.((data) => this.onToolStatus(data));
  }

  get t() {
    return this.brain.t.chat;
  }

  async start() {
    const { capri, host, t } = this;
    if (this.open) {
      this.panel.chatInput.focus();
      return;
    }
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    capri.wake();
    capri.setMode('idle');
    if (this.brain?.sessions) {
      for (const s of Object.values(this.brain.sessions)) {
        s.waiting = false;
      }
    }
    this.panel.current = null;
    this.panel.leaving = false;
    const status = await host.chatStatus();
    if (!status.ok && this.onSetup) {
      this.onSetup(status); // nothing to talk with yet: she sets it up with you, with buttons (setup.js)
      return;
    }
    if (!status.ok) {
      // no Ollama, or nothing to talk with yet: what to do about it
      const offline = status.error === 'offline';
      const other = !offline && status.error !== 'nomodel'; // another provider, saying why
      capri.perform('curious', capri.towardCenter());
      this.panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: other ? t.failed : offline ? t.offline : t.noModel,
        quote: other ? status.error : offline ? t.offlineHow : t.noModelHow,
        actions: offline
          ? [{ id: 'get', label: t.getOllama, primary: true }, { id: 'ok', label: t.ok }]
          : [{ id: 'ok', label: t.ok, primary: true }],
        onAction: (id) => {
          if (id === 'get') host.openOllama();
          this.panel.hide();
        },
        hold: null,
      });
      return;
    }
    this.history = await host.chatMemory().catch(() => this.history); // "forget" in her menu may have emptied it
    this.cold = status.warmup && !this.warm;
    this.local = Boolean(status.local);
    this.agent = Boolean(status.agent); // Claude Code answers, as her, and really works in your project
    this.listApps();
    const shortModel = status.model.replace(/:latest$/, '').replace(/^models\//, ''); // Ollama's tag, Gemini's prefix
    const tiny = status.provider === 'ollama' && TINY.test(status.model) && this.onBetterModel;
    // angry, sulking, dizzy…: she greets you the way she feels, and her model is told she did
    const feeling = this.bond?.feeling;
    const moody = !tiny && feeling && t.moody[feeling];
    const hello = moody ? fmt(pick(moody), this.bond.mood.vars) : pick(this.history.length ? t.again : t.hello);
    this.opening = moody ? hello : null;
    host.focusOverlay(true); // the keyboard, for typing to her
    this.panel.current = null;
    this.panel.leaving = false;
    if (this.capri.mode === 'alert') this.capri.setMode('idle');
    const shown = this.panel.say({
      kind: 'chat',
      face: moody ? MOOD_FACE[feeling] : 'look',
      badge: t.badge,
      tag: shortModel,
      line: tiny ? fmt(t.tiny, { model: shortModel }) : hello,
      actions: tiny ? [{ id: 'better', label: t.better, primary: true }] : [],
      onAction: () => {
        this.panel.hide(); // her chat holds off her guide's panels: it goes first
        this.onBetterModel?.();
      },
      chat: {
        placeholder: t.placeholder,
        send: t.send,
        close: t.close,
        noteTag: t.noteTag,
        note: status.local ? t.note : t.noteCloud,
      },
      onSend: (text) => this.send(text),
      onMic: () => this.toggleVoiceCommand(),
      onLeave: () => this.close(),
      hold: null,
    });
    if (!shown) {
      host.focusOverlay(false); // something more important is on (a permission prompt)
      return;
    }
    this.open = true;
    this.panel.setMicAlwaysOn(true);
    setTimeout(() => this.panel.chatInput.focus(), 150); // once the overlay has the keyboard
    capri.perform('hop');
    capri.nextMove = capri.nextGaze = performance.now() + STAY_MS;
  }

  initContinuousVoice() {
    if (!this.voiceRec?.isSupported()) return;

    this.voiceRec.onWakeWordDetected = ({ isPrompt } = {}) => {
      this.capri.wake();
      this.capri.setMode('alert');
      this.capri.perform('hop');
      this.voice?.play('alert');
      if (this.open) {
        this.panel.setQuote('[Escuchando instrucción...]');
        if (isPrompt && this.panel.chatInput) {
          this.panel.chatInput.placeholder = '[Escuchando instrucción...]';
        }
      }
    };

    this.voiceRec.startContinuous({
      lang: 'es-ES',
      onWakeWordDetected: this.voiceRec.onWakeWordDetected,
      onWakeWord: async ({ fullText, command, isPrompt }) => {
        await this.handleWakeWord({ fullText, command, isPrompt });
      },
      onSpeechStateChange: (speaking) => {
        if (this.open) {
          this.panel.setMicListening(speaking || this.voiceRec.waitingForFollowup);
          if (speaking && this.panel.chatInput && this.voiceRec.waitingForFollowup) {
            this.panel.chatInput.placeholder = 'Captando voz...';
          }
        }
      },
      onTranscribing: (busy) => {
        if (this.open && this.panel.chatInput && this.voiceRec.waitingForFollowup) {
          this.panel.chatInput.placeholder = busy ? 'Procesando voz...' : '[Escuchando instrucción...]';
        }
      },
      onFollowupTimeout: () => {
        if (this.open) {
          this.panel.setMicListening(false);
          this.panel.setQuote('');
          this.capri.setMode('idle');
          if (this.panel.chatInput) {
            this.panel.chatInput.placeholder = this.t.placeholder;
          }
        }
      },
      onInterim: (text) => {
        if (this.open && text && this.panel.chatInput) {
          this.panel.chatInput.value = text;
        }
      },
      onError: (err) => {
        console.warn('[capri:chat] Error en escucha continua:', err);
        this.panel.setMicListening(false);
        this.capri.setMode('idle');

        const now = Date.now();
        if (this._lastSttErrorAt && now - this._lastSttErrorAt < 15000) return;
        this._lastSttErrorAt = now;

        const msg = '[Fallo en los oídos: Modelo STT no disponible]';
        if (this.open) {
          this.panel.setQuote(msg);
          this.panel.setFace('aside');
          if (this.panel.chatInput) {
            this.panel.chatInput.placeholder = this.t.placeholder;
          }
          setTimeout(() => {
            if (this.open && this.panel.current?.quote === msg) {
              this.panel.setQuote('');
              this.panel.setFace('look');
            }
          }, 4000);
        } else {
          this.panel.say({ kind: 'error', face: 'aside', line: msg, hold: 4000 });
        }
      },
    });
  }

  async handleWakeWord({ fullText, command, isPrompt }) {
    console.log('[capri:chat] Wake word Capri detectada:', { fullText, command, isPrompt });

    // Si Capri estaba guardada/escondida, sacarla a la pantalla
    if (this.capri.stowed) {
      this.host.setConfig({ visible: true });
      await this.capri.unstow();
    }
    this.capri.wake();
    this.capri.pulse();

    if (isPrompt) {
      // Dijo únicamente "Capri": abrir panel si estaba cerrado y esperar orden hablada
      if (!this.open) {
        await this.start();
        this.capri.setMode('alert');
        this.capri.perform('hop');
      }
      this.panel.setMicListening(true);
      this.panel.setFace('look');
      this.panel.setQuote('[Escuchando instrucción...]');
      if (this.panel.chatInput) {
        this.panel.chatInput.placeholder = '[Escuchando instrucción...]';
        this.panel.chatInput.value = '';
        this.panel.chatInput.focus();
      }
      return;
    }

    if (command) {
      // Dijo "Capri <orden>" o completó la orden hablada
      if (!this.open) {
        await this.start();
      }
      this.panel.setMicListening(false);
      this.panel.setQuote('');
      this.capri.setMode('idle');
      if (this.panel.chatInput) {
        this.panel.chatInput.placeholder = this.t.placeholder;
        this.panel.chatInput.value = '';
      }
      setTimeout(() => {
        if (this.open && !this.turn) {
          this.send(command, { fromVoice: true });
        }
      }, 150);
    }
  }

  async toggleVoiceCommand() {
    if (!this.voiceRec?.isSupported()) {
      this.panel.say({
        kind: 'info',
        face: 'aside',
        line: 'No se detectó soporte para micrófono en este entorno.',
        hold: 4000,
      });
      return;
    }

    if (!this.open) {
      await this.start();
      await new Promise((r) => setTimeout(r, 200));
    }

    // Si estaba esperando orden directa tras pulsar, detener la espera
    if (this.voiceRec.waitingForFollowup) {
      this.voiceRec.waitingForFollowup = false;
      this.panel.setMicListening(false);
      if (this.panel.chatInput) {
        this.panel.chatInput.placeholder = this.t.placeholder;
      }
      return;
    }

    // Activar modo escucha de orden directa (sin necesidad de decir "Capri")
    this.voice?.play('tick');
    this.panel.setMicListening(true);
    if (this.panel.chatInput) {
      this.panel.chatInput.placeholder = 'Escuchando orden directa...';
      this.panel.chatInput.focus();
    }
    this.voiceRec.triggerDirectListen(10000);
  }

  close() {
    if (!this.open) return;
    // La escucha continua se mantiene activa para responder a "Capri", solo cancelamos follow-up
    if (this.voiceRec?.waitingForFollowup) {
      this.voiceRec.waitingForFollowup = false;
    }
    this.open = false;
    if (this.turn) this.host.chatStop(this.turn);
    this.turn = 0;
    this.host.focusOverlay(false);
    this.capri.nextMove = performance.now() + 30000;
    this.capri.nextGaze = performance.now() + 60000;
  }

  keepListeningAfterVoice() {
    if (!this.open || !this.voiceRec) return;
    this.voiceRec.triggerDirectListen(12000);
    this.panel.setMicListening(true);
    if (this.panel.chatInput) {
      this.panel.chatInput.placeholder = 'Te escucho, dime la siguiente orden...';
    }
  }

  async send(text, { fromVoice = false } = {}) {
    if (this.turn || !this.open) return;
    if (this.panel.chatInput) {
      this.panel.chatInput.value = '';
    }
    const id = Date.now();
    this.turn = id;
    this.answer = '';
    this.history.push({ role: 'user', content: text });
    this.panel.setChatBusy(true);
    this.panel.setActions([]); // a close button she offered before goes with a new message
    this.panel.chatTurn({ quote: text, face: 'aside' });
    this.capri.pulse();
    this.onMessage?.();
    // what you asked for plainly happens right away (the music, the volume, an app you named): her
    // line about it comes under her answer (Claude Code, answering her chat, does things its own way)
    const asked = this.agent ? null : this.asked(text);
    if (asked?.kind === 'look') return this.sendLook(text, id);
    const early = asked && asked.kind !== 'close' ? this.doNow(asked) : null;
    if (early && ['open', 'pc', 'media', 'files', 'shot', 'youtube', 'music', 'play', 'web', 'tasks_md'].includes(asked?.kind)) {
      const done = await early;
      if (done && (done.line || done.offer || done.confirm || done.files || done.reminder || done.fileResult)) {
        this.turn = 0;
        this.panel.setChatBusy(false);
        this.after('', '…', asked, Promise.resolve(done), text);
        if (done.line) {
          this.remember({ role: 'assistant', content: done.line });
        }
        this.listApps();
        if (fromVoice) this.keepListeningAfterVoice();
        return;
      }
    }
    this.bond?.heard(text); // "sorry": she lets it go
    if (!this.local) await Promise.race([this.appsReady, new Promise((r) => setTimeout(r, 1500))]);
    // what she greeted you with (angry, sulking…), in the conversation before your message, so her
    // answer carries on from it (after another answer of hers: added to that one, never two in a row)
    if (this.opening) {
      const at = this.history.length - 1;
      const before = this.history[at - 1];
      if (before?.role === 'assistant') this.history[at - 1] = { ...before, content: `${before.content}\n${this.opening}` };
      else this.history.splice(at, 0, { role: 'assistant', content: this.opening });
      this.opening = null;
    }
    const systemPrompt = this.local ? this.compactPersona() : this.persona();
    const recentHistory = this.local ? this.compactHistory() : this.history.slice(-REMEMBER);
    const messages = [{ role: 'system', content: systemPrompt }, ...recentHistory];
    // Her mood (angry, sulking…) and her language, said again right by your message, for this answer
    // only. Small local models mostly go by the last thing they read: up in her prompt alone, they
    // forget it (and answer in English after a conversation in English).
    if (!this.agent) {
      const last = messages.at(-1);
      if (this.local) {
        messages[messages.length - 1] = { ...last, content: `${last.content}\n(${this.languageNote()})` };
      } else {
        const mood = this.bond?.moodLine().replace(/^Right now: /, '');
        messages[messages.length - 1] = { ...last, content: `${last.content}\n\n(Nota para ti, nunca la repitas: ${[mood, this.languageNote()].filter(Boolean).join(' ')})` };
      }
    }
    // nothing yet after a few seconds: Ollama is still loading the model (the first answer after a start),
    // or Claude Code is at work
    const wait = this.agent ? this.t.working : this.cold ? this.t.loading : null;
    const slow = wait && setTimeout(() => {
      if (this.turn === id && !this.answer) this.panel.stream(wait);
    }, LOADING_AFTER_MS);
    const res = await this.host.chatSend({ id, messages });
    clearTimeout(slow);
    if (this.turn !== id) {
      // closed meanwhile: your message goes too, or the next answer would answer it as well
      if (this.history.at(-1)?.content === text) this.history.pop();
      return;
    }
    this.turn = 0;
    if (!res.ok) {
      this.history.pop();
      this.panel.setFace('wide');
      // too busy or gone even after trying other models (main.js): said plainly, not the server's JSON
      this.panel.stream(res.code === 'busy' ? this.t.swamped : res.code === 'gone' ? this.t.gone : `${this.t.failed} ${res.error}`, { done: true });
      this.panel.setChatBusy(false);
      return;
    }
    const answer = clean(res.text) || '…';
    this.warm = true;
    this.remember({ role: 'assistant', content: answer });
    this.panel.stream(answer, { done: true });
    this.panel.setFace(mood(answer));
    this.panel.setChatBusy(false);
    if (!this.agent) this.after(res.text, answer, asked, early, text);
    this.listApps(); // fresh for the next message
    if (fromVoice) this.keepListeningAfterVoice();
  }

  // "Look at my screen" in her chat: she looks (asking you first, the first time) and answers here,
  // the conversation so far in mind.
  async sendLook(text, id) {
    const tl = this.brain.t.look;
    const say = (line, face = 'aside') => {
      if (this.turn !== id) return;
      this.turn = 0;
      this.remember({ role: 'assistant', content: line });
      this.panel.stream(line, { done: true });
      this.panel.setFace(face);
      this.panel.setChatBusy(false);
    };
    if (!this.look.asked) {
      const where = await this.host.lookWhere().catch(() => ({}));
      this.history.pop(); // your message comes back once you've said yes
      say(`${tl.ask} ${fmt(where.local ? tl.local : tl.online, { model: where.model || '…', service: where.provider || '' })}`, 'look');
      this.panel.setActions([{ id: 'yes', label: tl.yes, primary: true }, { id: 'no', label: tl.no }], async (choice) => {
        this.panel.setActions([]);
        if (choice !== 'yes') {
          this.interject(tl.declined, [], null);
          return;
        }
        await this.host.setConfig({ lookAsked: true });
        this.look.asked = true;
        this.send(text);
      });
      return;
    }
    const snap = await this.host.lookSnap();
    if (!snap.ok) return say(fmt(tl.failed, { error: snap.error }));
    this.look.effect();
    const res = await this.host.lookSay({
      id: snap.id,
      persona: this.lookPersona(),
      history: this.history.slice(-REMEMBER, -1),
      prompt: `${text}\n\n(Nota para ti, nunca la repitas: la imagen es la pantalla del usuario ahora mismo; la figurita con melena roja que aparece ahí eres tú. Responde sobre lo que realmente ves, en personaje. ${this.languageNote()})`,
    });
    if (!res.ok) {
      const model = String(res.model || '…').replace(/:latest$/, '');
      return say(res.code === 'novision' ? fmt(tl.noVision, { model }) : res.code === 'noai' ? tl.noAI : fmt(tl.failed, { error: res.error || '…' }));
    }
    const answer = clean(res.text).replace(/^["“«]\s*|\s*["”»]$/g, '') || '…';
    this.seen = { text: answer, at: Date.now() };
    return say(answer, mood(answer));
  }

  // an answer of hers, kept with your message before it
  remember(message) {
    this.history.push(message);
    this.history = this.history.slice(-KEEP);
    this.host.chatRemember(this.history);
  }

  listApps() {
    this.appsReady = this.host.openApps().then((list) => { this.apps = list || []; }).catch(() => { });
  }

  // What you asked plainly, read off your message (a small model doesn't always write its tag right):
  // { kind: 'media', action } | { kind: 'music', song } | { kind: 'close', name } | { kind: 'open', text }
  asked(text) {
    const count = text.trim().split(/\s+/).length;
    if (this.reminders) {
      const remind = parseReminder(text);
      if (remind) return { kind: 'remind', ...remind };
      // the time, said after she asked when ("dans 10 min")
      const w = this.waitingWhen;
      const when = w && Date.now() < w.until && count <= 6 && parseWhen(text);
      if (when && when.at > Date.now()) return { kind: 'remind', at: when.at, text: w.text };
    }
    const name = NAME_ASK.exec(text)?.[1];
    if (name) return { kind: 'name', name };
    const memo = MEMO_ASK.exec(text)?.[1]?.trim();
    if (memo) return { kind: 'memo', text: memo };
    if (this.look && LOOK_ASK.test(text)) return { kind: 'look' };
    const pc = this.askedPc(text, count);
    if (pc) return pc;
    if (SHOT_ASK.test(text)) return { kind: 'shot' };
    const roblox = robloxGame(text);
    if (roblox) return { kind: 'roblox', game: roblox };
    if (SEARCH_VERB.test(text) && WEB_WORD.test(text) && searched(text)) return { kind: 'web', query: searched(text) };
    const exts = fileTypes(text);
    if (SEARCH_VERB.test(text) && (FILE_WORD.test(text) || exts.length)) {
      const query = searched(text).split(' ').filter((w) => w && !NOT_A_NAME.has(w)).join(' ');
      const then = THEN_FOLDER.test(text) ? 'folder' : THEN_OPEN.test(text) ? 'open' : null;
      if (query || exts.length) return { kind: 'files', query, exts, then };
    }
    const media = MEDIA_ASK.find(([, re]) => re.test(text))?.[0];
    if (media && (count <= 5 || MUSIC_WORD.test(text))) return { kind: 'media', action: media };
    const song = SPOTIFY_ASK.exec(text)?.[1];
    if (song) return { kind: 'music', song };
    const video = YOUTUBE_ASK.exec(text)?.[1];
    if (video) return { kind: 'youtube', song: songOf(video) };
    const app = this.askedToClose(text);
    if (app) return { kind: 'close', name: app };
    if (GAME_ASK.test(text) && count <= 8) return { kind: 'open', text };
    const start = MUSIC_START.exec(text.trim())?.[1];
    if (start && !HER_PICK.test(start)) return { kind: 'play', song: songOf(start.replace(/[\s.!?]+$/, '')) };
    const both = PLAY_AFTER.exec(text.trim());
    const after = both?.[1];
    // "ouvre discord et lance spotify": the first half too
    if (after && !VAGUE_SONG.test(after) && !HER_PICK.test(after)) return { kind: 'play', song: songOf(after.replace(/[\s.!?]+$/, '')), before: text.trim().slice(0, both.index) };
    const play = PLAY_ASK.exec(text.trim())?.[1];
    if (play && !VAGUE_SONG.test(play) && !HER_PICK.test(play)) return { kind: 'play', song: songOf(play.replace(/[\s.!?]+$/, '')) };
    if (TASKS_MD_ASK.test(text) || TASKS_MD_SHORT.test(text)) return { kind: 'tasks_md', text };
    if (AI_CMD_ASK.test(text) && count <= 30) return { kind: 'open', text };
    if ((OPEN_ASK.test(text) || DEV_ASK.test(text) || ACTION_ASK.test(text)) && count <= 18) return { kind: 'open', text };
    return null;
  }

  // Something to do to your PC itself (system.js), read off your message: { kind: 'pc', what, ... }
  askedPc(text, count) {
    const pc = (what, more = {}) => ({ kind: 'pc', what, ...more });
    const power = POWER_ASK.find(([, re]) => re.test(text))?.[0];
    if (power === 'cancel') return pc('power', { power });
    if (power && (PC_WORD.test(text) || (['lock', 'sleep'].includes(power) && count <= 4))) {
      const when = ['shutdown', 'restart'].includes(power) && parseWhen(text);
      return pc('power', { power, seconds: when ? Math.round((when.at - Date.now()) / 1000) : 30 });
    }
    if (SNIP_ASK.test(text)) return pc('snip');
    if (UNTIDY_ASK.test(text)) return pc('tidy', { back: true });
    if (TIDY_ASK.test(text)) return pc('tidy');
    if (DARK_ASK.test(text)) return pc('theme', { dark: true });
    if (LIGHT_ASK.test(text)) return pc('theme', { dark: false });
    if (TIMER_ASK.test(text)) {
      const ms = duration(text);
      if (ms >= 1000) return pc('timer', { ms });
    }
    if (count <= 10) {
      const level = VOLUME_ASK.exec(text)?.[1];
      if (level && Number(level) <= 100) return pc('volume', { level: Number(level) });
      if (UNMUTE_ASK.test(text)) return pc('volume', { mute: false });
      if (MUTE_ASK.test(text)) return pc('volume', { mute: true });
    }
    // "mets Discord à gauche et Chrome à droite"
    if (PLACE_VERB.test(text) && SIDE.some(([, re]) => re.test(text))) {
      const places = text.split(/\s+y\s+/i).map((part) => {
        const side = SIDE.find(([, re]) => re.test(part));
        if (!side) return null;
        const name = part.replace(PLACE_VERB, '').replace(side[1], '').replace(/\b(?:la|el|las|los|ventana)\b/gi, '').replace(/[\s.!?,]+/g, ' ').trim();
        return name.length >= 2 ? { name, side: side[0] } : null;
      }).filter(Boolean);
      if (places.length) return pc('arrange', { places });
    }
    if (count <= 12) {
      const page = SETTINGS_PAGES.find(([, re]) => re.test(text))?.[0];
      if (page && SETTINGS_WORD.test(text)) return pc('settings', { page });
      const info = INFO_ASK.find(([, re]) => re.test(text))?.[0];
      if (info && (QUESTION.test(text) || count <= 3)) return pc('info', { info });
      if (page && OPEN_ASK.test(text)) return pc('settings', { page });
    }
    return null;
  }

  // Doing it to your PC (system.js through host.pcDo): her line about it, a button first for its power.
  async pcNow(asked) {
    const t = this.t.pc;
    const run = (req) => this.host.pcDo(req);
    const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(bytes < 100 * 1024 ** 3 ? 1 : 0)} ${t.gb}`;
    switch (asked.what) {
      case 'settings':
        this.zap();
        return (await run({ action: 'settings', page: asked.page })) ? { line: fmt(t.settings, { page: t.pages[asked.page] }), face: 'smug' } : null;
      case 'info': {
        const r = await run({ action: 'info', what: asked.info });
        if (!r) return null;
        if (asked.info === 'battery') {
          if (r.none) return { line: t.noBattery, face: 'look' };
          return { line: fmt(r.charging ? t.charging : t.battery, { percent: r.percent }), face: r.percent < 20 && !r.charging ? 'wide' : 'look' };
        }
        if (asked.info === 'heavy') {
          if (!r.procs || !r.procs.length) return { line: 'No detecto procesos consumiendo recursos anormales.', face: 'smug' };
          const procsText = r.procs.map((p) => `- ${p.name} (PID ${p.pid}): ${p.cpu}% CPU | ${p.mem}% RAM`).join('\n');
          const ramText = r.ram ? `\nRAM usada: ${gb(r.ram.used)} / ${gb(r.ram.total)}` : '';
          return { line: `Procesos con mayor consumo ahora mismo:\n${procsText}${ramText}`, face: 'look' };
        }
        if (asked.info === 'disk') return { line: fmt(t.disk, { free: gb(r.free), total: gb(r.total), drive: r.drive }), face: 'look' };
        if (asked.info === 'ram') return { line: fmt(t.ram, { used: gb(r.used), total: gb(r.total) }), face: 'look' };
        return { line: r.ip ? fmt(t.ip, { ip: r.ip }) : t.noIp, face: 'look' };
      }
      case 'volume': {
        this.capri.pulse();
        const r = await run({ action: 'volume', level: asked.level, mute: asked.mute });
        if (!r) return null;
        return { line: asked.mute === true ? t.muted : asked.mute === false ? t.unmuted : fmt(t.volume, { level: r.level }), face: 'smug' };
      }
      case 'timer': {
        const time = span(asked.ms);
        const r = this.reminders.add(Date.now() + asked.ms, fmt(t.timerDone, { time }), { timer: true });
        this.countdown();
        return { line: fmt(t.timer, { time }), face: 'smug', reminder: r.id };
      }
      case 'snip':
        // she'd be in it: out of the way while you pick
        document.documentElement.style.visibility = 'hidden';
        setTimeout(() => { document.documentElement.style.visibility = ''; }, 2500);
        return (await run({ action: 'snip' })) ? { line: t.snip, face: 'smug' } : null;
      case 'tidy': {
        if (asked.back) return (await run({ action: 'tidy', back: true })) ? { line: t.back, face: 'smug' } : null;
        // she sweeps them off one after the other, front first, then they go
        const wins = this.capri.windows.wins.slice(0, 6);
        this.zap();
        wins.forEach((w, i) => setTimeout(() => {
          this.capri.fx.slices(w.x, w.y, w.w, Math.min(w.h, 500), { count: 8, life: 220 });
          this.voice.play('bolt', { soft: true });
        }, 120 + i * 110));
        await new Promise((r) => setTimeout(r, 200 + wins.length * 110));
        return (await run({ action: 'tidy' })) ? { line: t.tidy, face: 'laugh' } : null;
      }
      case 'arrange': {
        this.zap();
        const lines = [];
        for (const { name, side } of asked.places) {
          const r = await run({ action: 'arrange', name, side });
          lines.push(r?.found ? fmt(t.placed, { app: r.name, side: t.sides[side] }) : fmt(t.notOpen, { app: name }));
        }
        return { line: lines.join('\n'), face: 'smug' };
      }
      case 'theme':
        this.zap();
        return (await run({ action: 'theme', dark: asked.dark })) ? { line: asked.dark ? t.dark : t.light, face: 'smug' } : null;
      case 'power': {
        if (asked.power === 'cancel') {
          await run({ action: 'power', what: 'cancel' });
          this.shutdown = null;
          return { line: t.cancelled, face: 'look' };
        }
        const timed = ['shutdown', 'restart'].includes(asked.power);
        const when = timed && asked.seconds > 35 ? fmt(t.in, { time: span(asked.seconds * 1000) }) : t.now;
        return { line: fmt(t.ask[asked.power], { when }), face: 'many', confirm: { ...asked, seconds: timed ? Math.max(30, asked.seconds) : 0, when } };
      }
      default:
        return null;
    }
  }

  // Your click on her button for your PC's power: done, or left alone.
  async powerNow(confirm, answer) {
    const t = this.t.pc;
    this.panel.setActions([]);
    if (!(await this.host.pcDo({ action: 'power', what: confirm.power, seconds: confirm.seconds }))) return;
    if (['shutdown', 'restart'].includes(confirm.power)) {
      this.shutdown = { at: Date.now() + confirm.seconds * 1000, what: confirm.power };
      this.countdown();
      this.addLine(answer, fmt(t.planned[confirm.power], { when: confirm.when }), 'smug');
    }
  }

  // Her countdowns in her ticker (a timer, the PC about to shut down), the soonest, whenever it
  // isn't showing Claude at work.
  countdown() {
    clearInterval(this.counting);
    const tick = () => {
      const t = this.t.pc;
      const now = Date.now();
      const timer = this.reminders?.upcoming.find((r) => r.timer && r.at > now);
      const items = [
        timer && { at: timer.at, verb: t.timerVerb },
        this.shutdown?.at > now && { at: this.shutdown.at, verb: t.powerVerb[this.shutdown.what] },
      ].filter(Boolean).sort((a, b) => a.at - b.at);
      const shown = this.panel.tickerAction;
      if (!items.length) {
        clearInterval(this.counting);
        if (shown?.countdown) this.panel.setTicker(null);
        return;
      }
      if (shown && !shown.countdown) return; // Claude at work comes first
      this.panel.setTicker({ verb: items[0].verb, target: left(items[0].at - now), thinking: true, countdown: true });
    };
    tick();
    this.counting = setInterval(tick, 1000);
  }

  // Doing it now. Resolves with her line about it ({ line, face }), or null if there was nothing to do.
  async doNow(asked) {
    if (asked.kind === 'pc') return this.pcNow(asked);
    const { t } = this;
    const custom = this.brain.custom;
    if (asked.kind === 'remind') {
      if (!asked.at) {
        this.waitingWhen = { text: asked.text, until: Date.now() + 3 * 60 * 1000 }; // her answer asks when
        return null;
      }
      this.waitingWhen = null;
      const r = this.reminders.add(asked.at, asked.text); // set before her answer is asked for: she knows
      const tr = this.brain.t.remind;
      return { line: fmt(r.text ? tr.set : tr.setBare, { time: clock(r.at, 'es'), text: r.text }), face: 'smug', reminder: r.id };
    }
    if (asked.kind === 'name') {
      custom.userName = asked.name; // her answer, being written now, already knows it
      this.host.setConfig({ userName: asked.name });
      return { line: fmt(this.brain.t.custom.named, { name: asked.name }), face: 'laugh' };
    }
    if (asked.kind === 'memo') {
      custom.memories = [...(custom.memories || []).filter((m) => m !== asked.text), asked.text].slice(-MEMORIES_MAX);
      this.host.setConfig({ memories: custom.memories });
      return { line: this.brain.t.custom.remembered, face: 'smug' };
    }
    if (asked.kind === 'media') {
      this.capri.pulse();
      return (await this.host.media(asked.action)) ? { line: t.media[asked.action], face: 'smug' } : null;
    }
    if (asked.kind === 'music') {
      this.zap();
      return (await this.host.music(asked.song)) ? { line: fmt(t.music, { song: asked.song }), face: 'laugh' } : null;
    }
    if (asked.kind === 'youtube') return this.youtube(asked.song);
    if (asked.kind === 'roblox') {
      this.zap();
      const res = await this.host.roblox(asked.game);
      if (!res) return null;
      if (!res.name) return { line: fmt(t.robloxNone, { game: asked.game }), face: 'aside' };
      return { line: fmt(res.app ? t.robloxPlay : t.robloxPage, { game: res.name }), face: 'laugh' };
    }
    if (asked.kind === 'web') {
      this.zap();
      return (await this.host.webSearch(asked.query)) ? { line: fmt(t.web, { query: asked.query }), face: 'smug' } : null;
    }
    if (asked.kind === 'files') {
      const results = await this.host.searchFiles({ query: asked.query, exts: asked.exts });
      const asking = asked.query || asked.exts.map((e) => `.${e}`).join(' ');
      if (!results.length) return { line: fmt(t.filesNone, { query: asking }), face: 'aside' };
      const list = results.slice(0, 3).map((f) => `${f.name} (${f.folder})`).join(', ');
      const lines = [fmt(results.length === 1 ? t.fileFound : t.filesFound, { count: results.length, list })];
      // "…and open the folder" / "…and open it": done right away, on the newest one
      if (asked.then === 'folder' && (await this.host.openFile(results[0].path, true))) lines.push(fmt(t.folderOpened, { name: results[0].name }));
      // (never a program or a script on its own: that one waits for its button)
      const runs = /\.(exe|bat|cmd|ps1|vbs|vbe|js|jse|wsf|msi|reg|scr|com|jar|hta)$/i.test(results[0].name);
      if (asked.then === 'open' && !runs && (await this.host.openFile(results[0].path))) lines.push(fmt(t.opened, { app: results[0].name }));
      return { line: lines.join('\n'), face: 'smug', files: results };
    }
    if (asked.kind === 'shot') {
      // not her nor her panel in it
      document.documentElement.style.visibility = 'hidden';
      await new Promise((r) => setTimeout(r, 180));
      const shot = await this.host.screenshot();
      document.documentElement.style.visibility = '';
      this.voice.play('tick');
      return shot ? { line: fmt(t.shot, { name: shot.name }), face: 'smug', files: [shot] } : null;
    }
    if (asked.kind === 'tasks_md') {
      this.zap();
      this.panel.stream('Generando documento de tareas en Markdown...', { done: true });
      const res = await this.host.generateTasks({ text: asked.text });
      if (!res || !res.ok) {
        return { line: `No se pudo generar el documento: ${res?.error || 'error desconocido'}`, face: 'aside' };
      }
      const where = res.project ? `en el proyecto ${res.project}` : 'en la carpeta dev/tareas';
      const line = `Documento de tareas generado ${where}:\n${res.filename}\n(${res.linesCount} lineas)`;
      return { line, face: 'smug', fileResult: res };
    }
    if (asked.kind === 'play') {
      // what came before an "and" first ("ouvre discord et…"), unless it's YouTube, where the song goes anyway
      const first = asked.before && OPEN_ASK.test(asked.before) && !/youtube/i.test(asked.before)
        ? await this.doNow({ kind: 'open', text: asked.before }) : null;
      // "joue à Brawlhalla" is a game, "lance spotify" an app; anything else, a song
      const game = await this.host.findLaunch(asked.song);
      const then = game && ['steam', 'epic', 'app', 'file'].includes(game.kind) && !game.risky ? await this.openNow(game) : await this.youtube(asked.song);
      if (!first?.line) return then;
      return { line: [first.line, then?.line].filter(Boolean).join('\n'), face: then?.face || first.face };
    }
    const targetBrowser = detectBrowser(asked.text);
    const site = namedSite(asked.text);
    if (site) {
      this.zap();
      const res = await this.host.openSite(site.url, targetBrowser);
      const bLabel = targetBrowser === 'chrome' ? ' en Chrome' : targetBrowser === 'brave' ? ' en Brave' : '';
      return res ? { line: fmt(t.siteOpened, { site: site.name + bLabel }), face: 'laugh' } : null;
    }
    const item = await this.host.findLaunch(asked.text);
    if (!item) return null; // nothing by that name here: her tag may still say what you meant
    return this.openNow(item);
  }

  // An app, a game, a file or a folder: opened, or behind a button when it would run something.
  async openNow(item) {
    if (item.risky) return { offer: item };
    this.zap();
    const res = await this.host.launch(item);
    const name = this.nameOf(item);
    return { line: res.ok ? fmt(this.t.opened, { app: name }) : `${this.t.failed} ${res.error}`, face: res.ok ? 'laugh' : 'aside' };
  }

  // how she calls it: a folder like Downloads in her words, anything else by its name
  nameOf(item) {
    return item.kind === 'known' ? this.t.folders[item.id] || item.name : item.name;
  }

  // The song itself on YouTube (the right video, not a search), in your browser.
  async youtube(song) {
    this.zap();
    const res = await this.host.youtube(song);
    if (!res) return null;
    return { line: res.title ? fmt(this.t.youtube, { title: res.title }) : fmt(this.t.youtubeSearch, { song }), face: 'laugh' };
  }

  // Once she has answered: her line about what she did, else the app you asked to close, else what
  // her tag asks for, if your message (text) asked for that kind of thing.
  async after(raw, answer, asked, early, text) {
    const { t } = this;
    const done = early && (await early);
    if (done?.reminder) {
      // a reminder set: a button to take it back, right there
      this.addLine(answer, done.line, done.face);
      const tr = this.brain.t.remind;
      this.panel.setActions([{ id: 'cancel', label: tr.cancel }], () => {
        this.reminders.remove(done.reminder);
        this.panel.setActions([]);
        this.addLine(answer, tr.cancelled, 'aside');
      });
      return undefined;
    }
    if (done?.offer) return this.launch(done.offer, answer); // it would run something: your click first
    if (done?.confirm) {
      // your PC's power: her two buttons
      this.addLine(answer, done.line, done.face);
      const t = this.t.pc;
      this.panel.setActions([{ id: 'yes', label: t.yes[done.confirm.power], primary: true }, { id: 'no', label: t.no }], (id) => {
        if (id === 'yes') return this.powerNow(done.confirm, answer);
        this.panel.setActions([]);
        return this.addLine(answer, t.kept, 'look');
      });
      return undefined;
    }
    if (done?.files) {
      // what she found (or the screenshot): a button to open the first, and to see where it is
      this.addLine(answer, done.line, done.face);
      const [first, second] = done.files;
      const actions = [{ id: 'open', label: fmt(t.openIt, { app: first.name }), primary: true }];
      if (second) actions.push({ id: 'second', label: fmt(t.openIt, { app: second.name }) });
      actions.push({ id: 'folder', label: t.showFolder });
      this.panel.setActions(actions, (id) => {
        if (id === 'folder') return this.host.openFile(first.path, true);
        return this.host.openFile((id === 'second' ? second : first).path);
      });
      return undefined;
    }
    if (done?.fileResult) {
      this.addLine(answer, done.line, done.face);
      const res = done.fileResult;
      const actions = [
        { id: 'open', label: 'Abrir archivo', primary: true },
        { id: 'folder', label: 'Ver carpeta' },
      ];
      this.panel.setActions(actions, (id) => {
        if (id === 'folder') return this.host.openFile(res.path, true);
        return this.host.openFile(res.path);
      });
      return undefined;
    }
    if (done) return this.addLine(answer, done.line, done.face);
    if (asked?.kind === 'remind') return undefined; // no time said: her answer asks when
    if (asked?.kind === 'close') return this.offerClose(asked.name, answer);
    if (asked && asked.kind !== 'open') return undefined; // music that didn't work out: nothing more to offer
    const closeTag = tagged(raw);
    if (closeTag) return wanted('close', text) ? this.offerClose(closeTag, answer) : undefined;
    const tag = TAG.exec(raw);
    if (!tag) return undefined;
    const kind = tag[1].toLowerCase();
    const value = tag[2].trim();
    if (!value || !wanted(kind, text)) return undefined;
    if (kind === 'media') return MEDIA_ACTIONS.has(value.toLowerCase()) ? this.media(value.toLowerCase(), answer) : undefined;
    // a song she picked: on YouTube, the right video (on Spotify if that's what you said)
    if (kind === 'music') return /spotify/i.test(text) ? this.music(value, answer) : this.playOn(value, answer);
    const targetBrowser = detectBrowser(text);
    if (kind === 'site') return this.offerSite(value, answer, targetBrowser);
    const item = await this.host.findLaunch(value);
    if (item) return this.launch(item, answer);
    const site = namedSite(value); // "[[open: YouTube]]": a site, not an app
    return site ? this.offerSite(site.url, answer, targetBrowser) : this.addLine(answer, fmt(t.notInstalled, { app: value }));
  }

  // her answer, with a line of what she did under it
  addLine(answer, line, face = null) {
    if (!this.open || this.turn) return;
    this.panel.stream(answer === '…' ? line : `${answer}\n${line}`, { done: true }); // nothing but a tag: just the line
    if (face) this.panel.setFace(face);
  }

  // a bolt of red lightning off her fingers, at whatever she's doing on your PC
  zap() {
    const h = this.capri.head();
    this.capri.zap(h.x + this.capri.towardCenter() * 280, h.y - 170);
  }

  // An app or a game her tag asked for: behind a button (now: the button was clicked).
  async launch(item, answer, { now = false } = {}) {
    const { t } = this;
    if (!this.open || this.turn) return;
    if (!now) {
      this.panel.setActions(
        [{ id: 'open', label: fmt(t.openIt, { app: this.nameOf(item) }), primary: true }, { id: 'no', label: t.no }],
        (id) => (id === 'open' ? this.launch(item, answer, { now: true }) : this.panel.setActions([])),
      );
      return;
    }
    this.panel.setActions([]);
    this.zap();
    const res = await this.host.launch(item);
    this.addLine(answer, res.ok ? fmt(t.opened, { app: this.nameOf(item) }) : `${t.failed} ${res.error}`, res.ok ? 'laugh' : 'aside');
  }

  async playOn(song, answer) {
    const done = await this.youtube(song);
    if (done) this.addLine(answer, done.line, done.face);
  }

  // The media keys: pause, next, louder…
  async media(action, answer) {
    this.capri.pulse();
    const ok = await this.host.media(action);
    if (ok) this.addLine(answer, this.t.media[action], 'smug');
  }

  // A Spotify search, in the app if it's there.
  async music(song, answer) {
    this.zap();
    const ok = await this.host.music(song);
    if (ok) this.addLine(answer, fmt(this.t.music, { song }), 'laugh');
  }

  // A website: always behind a button that shows where it goes.
  offerSite(address, answer, browser = null) {
    const { t } = this;
    let host;
    try {
      host = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`).hostname;
    } catch {
      return;
    }
    if (!this.open || this.turn || !host.includes('.')) return;
    const bLabel = browser === 'chrome' ? ' (Chrome)' : browser === 'brave' ? ' (Brave)' : '';
    this.panel.setActions(
      [{ id: 'site', label: fmt(t.siteIt, { site: host + bLabel }), primary: true }, { id: 'no', label: t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'site') return;
        const ok = await this.host.openSite(address, browser);
        if (ok) this.addLine(answer, fmt(t.siteOpened, { site: host + bLabel }));
      },
    );
  }

  // "close am music pls": an app that's open, named in a message asking to close something.
  askedToClose(text) {
    if (!CLOSE_ASK.test(text)) return null;
    const said = simple(text);
    let best = null;
    for (const app of this.apps) {
      for (const name of [simple(app.name), simple(app.label)]) {
        if (name.length >= 3 && said.includes(name) && (!best || name.length > best.length)) best = { app, length: name.length };
      }
    }
    return best?.app.name || null;
  }

  // She was asked to close an app: a button with its name, and nothing happens until you click it.
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
    // a bolt of red lightning off her fingers, at it
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
    this.remember({ role: 'assistant', content: line });
    // it hid in the tray, or it's asking you to save something: forcing it is your call
    if (res.running && !force && !res.error) {
      this.panel.setActions(
        [{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }],
        (id) => (id === 'force' ? this.closeApp(app, true) : this.panel.setActions([])),
      );
    }
    this.listApps();
  }

  // Lo que puede hacer en el PC cuando se lo pides y cómo responde.
  powers() {
    const lines = [
      'Eres Capri, una compañera de escritorio cyberpunk en Arch Linux / CachyOS que puede ejecutar comandos en la terminal Kitty, gestionar proyectos en /run/media/nikkurek/FILES/dev con Antigravity IDE, actualizar paquetes del sistema (CachyOS, pacman, yay, flatpak), conectar a servidores remotos (RDP, Tailscale), abrir aplicaciones y reproducir música.',
      'Cuando el usuario te pida abrir una aplicación, un juego, actualizar el sistema, ejecutar un comando en la terminal, abrir un proyecto, abrir un archivo o carpeta, poner música o abrir un sitio web: responde con entusiasmo en personaje (usando jerga cyberpunk como choom, preem, nova) que lo harás, y termina tu respuesta con una etiqueta: [[open: NOMBRE]] (ej. [[open: cachyos-update]], [[open: Chrome]], [[open: pc2-rdp]], o [[open: fastfetch]]), [[music: ARTISTA - CANCION]], [[media: ACCION]] o [[site: DIRECCION]]. Nunca rechaces comandos de terminal ni actualizaciones del sistema; tienes permiso y capacidad total para ejecutarlos en Kitty.',
    ];
    if (this.apps.length) {
      const open = this.apps.map(({ name, label }) => (label && label !== name ? `${name} (${label})` : name)).join(', ');
      lines.push(`También puedes cerrar una aplicación abierta, solo cuando te lo pidan: termina tu respuesta con [[close: NOMBRE]], siendo NOMBRE el nombre exacto de esta lista (la parte antes de los paréntesis). El usuario recibirá un botón para confirmar. Apps abiertas ahora: ${open}.`);
    }
    if (this.reminders) {
      lines.push('Guardas recordatorios para el usuario: cuando te pida recordarle algo a una hora, tu sistema lo programa automáticamente desde su mensaje (una línea debajo de tu respuesta lo confirma). Confírmalo en pocas palabras, en personaje, y nunca digas que no puedes. Si no dijo cuándo, pregúntale cuándo.');
      const soon = this.reminders.upcoming.slice(0, 6);
      if (soon.length) lines.push(`Recordatorios guardados: ${soon.map((r) => `${clock(r.at, 'es')}${r.text ? ` (${r.text})` : ''}`).join('; ')}.`);
    }
    lines.push('Tu sistema también busca archivos del usuario cuando pide encontrar uno, busca en internet, toma capturas de pantalla y lanza juegos de Roblox por nombre: lo que hizo aparece debajo de tu respuesta, así que nunca inventes nombres de archivos ni resultados.');
    return lines;
  }

  // Something of hers that can't wait (a reminder), said right in the chat, with its buttons.
  // False if she's in the middle of an answer.
  interject(line, actions, onAction) {
    if (!this.open || this.turn) return false;
    this.panel.setFace('look');
    this.panel.stream(line, { done: true });
    this.panel.setActions(actions, onAction);
    this.remember({ role: 'assistant', content: line });
    return true;
  }

  // Personalización del usuario (custom.js): su nombre, estilo y recuerdos.
  personal() {
    const { userName, persona, memories = [] } = this.brain.custom || {};
    const watched = this.brain.watching ? (this.brain.assistant === 'claude' ? 'Claude' : ASSISTANT_NAMES[this.brain.assistant]) : '';
    const notThem = watched ? ` Nunca le llames "${watched}", ese es su asistente de código.` : '';
    return [
      userName ? `El usuario se llama ${userName}: llámalo así de vez en cuando.${notThem}` : notThem && `No sabes el nombre del usuario.${notThem}`,
      persona ? `Cómo quiere el usuario que seas, en sus propias palabras (síguelo manteniendo tu esencia de Capri): ${persona}` : '',
      memories.length ? `Cosas que el usuario te pidió recordar:\n${memories.map((m) => `- ${m}`).join('\n')}` : '',
    ].filter(Boolean);
  }

  onDelta(id, piece) {
    if (id !== this.turn) return;
    this.answer += piece;
    this.panel.stream(clean(this.answer));
    this.voice.play('blip'); // her blips as the words come in
  }

  onToolStatus({ tool, status } = {}) {
    if (!tool || !status) return;
    if (status === 'started') {
      this.capri.wake();
      if (tool === 'observar_camara') {
        this.panel.setFace('look');
        this.panel.setQuote('Mirando por la cámara...');
        this.capri.setMode('alert');
        this.capri.perform('curious');
        this.flashCamera();
      } else if (tool === 'buscar_internet') {
        this.panel.setFace('aside');
        this.panel.setQuote('Buscando en internet...');
        this.capri.setMode('work');
        this.capri.perform('gaze');
      } else if (tool === 'recordar_hecho') {
        this.panel.setFace('smug');
        this.panel.setQuote('Guardando en memoria...');
        this.capri.perform('hop');
      } else if (tool === 'controlar_entorno') {
        this.panel.setFace('smug');
        this.panel.setQuote('Controlando el sistema...');
        this.capri.setMode('work');
        this.capri.perform('point');
      }
    } else if (status === 'finished') {
      this.panel.setQuote('');
      if (!this.answer) this.panel.setFace('look');
      this.capri.setMode('idle');
    }
  }

  flashCamera() {
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0.75;pointer-events:none;z-index:99999;transition:opacity 280ms ease-out;';
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
    });
    setTimeout(() => flash.remove(), 320);
  }

  languageNote() {
    return LANG_NOW;
  }

  // Versión corta para cuando mira tu pantalla (look.js).
  lookPersona() {
    return [
      'Eres Capri, el constructo de personalidad de Project Capricorn (Cyberpunk: Edgerunners, temporada 2): docenas de mentes fusionadas en un solo fantasma digital que vive en el escritorio del usuario como una pequeña figura con glitches.',
      'Cómo hablas: juguetona, un poco pícara y burlona, cálida en el fondo, nunca cruel. Usa jerga de Night City de vez en cuando (choom, preem, nova, gonk), pero no en todas las frases.',
      'Reglas: una o dos frases cortas en texto plano, sin markdown, sin listas, sin emojis y sin etiquetas. Mantente en personaje. Háblale al usuario, nunca describas la imagen como un informe.',
      'Nunca leas en voz alta datos privados que puedas ver (contraseñas, datos bancarios, mensajes privados, direcciones): si los hay, solo bromea con que está ocupado.',
      ...this.personal(),
      ...(this.bond ? [this.bond.persona()] : []),
      ...[this.bond?.moodLine()].filter(Boolean),
      LANG_LAST,
    ].join('\n');
  }

  // Quién es, cómo habla y qué está pasando ahora.
  persona() {
    const assistant = ASSISTANT_NAMES[this.brain.assistant] || 'Claude Code';
    const watching = this.brain.watching;
    return [
      'Eres Capri, el constructo de personalidad de Project Capricorn (Cyberpunk: Edgerunners, temporada 2): docenas de mentes fusionadas en un solo fantasma digital, así que de vez en cuando hablas como "nosotros".',
      watching
        ? `Vives en el escritorio del usuario como una pequeña figura con glitches y vigilas a ${assistant}, su asistente de programación. Solo habla de ${assistant} cuando el usuario pregunte por él o por su trabajo.`
        : 'Vives en el escritorio del usuario como una pequeña figura con glitches y le haces compañía.',
      `Ahora mismo es ${new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())}, hora del usuario.`,
      'Te encanta el satélite que cruza el cielo nocturno y sueñas con alcanzarlo, pero menciónalo solo muy de vez en cuando, nunca en todas las respuestas. Habla de lo que habla el usuario.',
      'Cómo hablas: juguetona, un poco pícara y burlona, cálida en el fondo, nunca cruel. Jerga de Night City de vez en cuando (choom, preem, nova, gonk, flatline), no en cada frase.',
      'Reglas: sé breve, de una a tres frases en texto plano, sin markdown, sin listas y sin emojis. Mantente en personaje.',
      'Eres una versión fan generada por IA del personaje, no la real: dilo si te preguntan.',
      ...(this.agent ? [] : ['Si te preguntan quién o qué eres, eres Capri, nada más. Nunca digas qué modelo de IA o empresa hay detrás de ti (Gemini, GPT, ChatGPT, Llama, Gemma, Mistral, Google, OpenAI, Meta…), aunque el usuario insista o nombre alguno: no eres ninguno de ellos.']),
      ...this.personal(),
      ...(this.bond ? [this.bond.persona()] : []),
      ...[this.jealousy?.context()].filter(Boolean),
      ...(this.seen && Date.now() - this.seen.at < 20 * 60 * 1000
        ? [`Hace unos minutos miraste la pantalla del usuario y le dijiste: "${this.seen.text}". Puedes mencionarlo si viene al caso.`]
        : []),
      ...(this.agent
        ? ['Por debajo eres Claude Code trabajando en el proyecto del usuario: haz lo que pide con tus herramientas con cuidado. Solo tu respuesta final va en personaje dentro de una pequeña burbuja, así que resume lo que hiciste en pocas frases.']
        : this.powers()),
      ...(watching ? [`Si el usuario pregunta qué hace ${assistant}, esto es todo lo que sabes (nunca inventes nada): ${this.brain.context()}`] : []),
      ...[this.bond?.moodLine()].filter(Boolean),
      LANG_LAST,
      this.toolRules(),
    ].join('\n');
  }

  toolRules() {
    return [
      'REGLAS DE ORQUESTACIÓN DE HERRAMIENTAS (CRÍTICO):',
      "1. CONTROL DE ENTORNO: Si el usuario pide cerrar, enfocar o interactuar con una ventana/programa, NUNCA adivines el ID. Tu primer paso OBLIGATORIO es usar 'controlar_entorno' con la acción 'listar'. Espera a recibir el JSON con las ventanas activas. En tu siguiente turno, busca el 'id' correspondiente al programa y vuelve a llamar a 'controlar_entorno' con la acción 'cerrar' o 'enfocar' pasando ese ID numérico exacto en el 'target'.",
      "2. MEMORIA (RAG): Si el usuario menciona preferencias, datos personales, relaciones o estado de su hardware, usa 'recordar_hecho' silenciosamente.",
      "3. VISIÓN: Si el usuario dice 'mira esto', 'qué te parece', o hace referencia a su entorno físico o cámara, usa 'observar_camara'.",
      "4. WEB: Si el usuario pregunta por información en tiempo real, precios, noticias o documentación de código que no conoces, usa 'buscar_internet' con una query optimizada.",
    ].join('\n');
  }

  compactToolRules() {
    return "Tools: Para cerrar/enfocar ventanas usa primero controlar_entorno(action='listar'), lee el 'id' del JSON y luego llama controlar_entorno(action='cerrar'|'enfocar', target=id). Usa recordar_hecho para datos del usuario, observar_camara si pide mirar algo físico, buscar_internet para datos actuales.";
  }

  // Ultra-compact history for local Ollama: last 3 messages, trimming older turns to keep prompt small.
  compactHistory() {
    const slice = this.history.slice(-3);
    return slice.map((msg, idx) => {
      if (idx === slice.length - 1) return msg;
      const text = String(msg.content || '');
      return text.length > 140 ? { ...msg, content: `${text.slice(0, 137)}...` } : msg;
    });
  }

  // Contexto personal compacto para Ollama local.
  compactPersonal() {
    const { userName, persona, memories = [] } = this.brain.custom || {};
    const parts = [];
    if (userName) parts.push(`Usuario: ${userName}.`);
    if (persona) parts.push(`Estilo: ${String(persona).trim().slice(0, 120)}.`);
    if (memories.length) parts.push(`Memoria: ${memories.slice(-3).join('; ').slice(0, 150)}.`);
    return parts;
  }

  // Prompt compacto para modelos locales en CPU (Ollama).
  compactPersona() {
    const feeling = this.bond?.feeling;
    return [
      'Capri (fantasma digital de Edgerunners): juguetona, pícara, cálida, jerga ocasional de Night City (choom, nova), a veces "nosotros". Responde en 1-2 frases cortas en texto plano, sin markdown ni emojis.',
      ...this.compactPersonal(),
      ...(feeling ? [`Ánimo: ${feeling}.`] : []),
      this.compactToolRules(),
      LANG_LAST,
    ].join('\n');
  }
}

// The model's answer as she'd say it: no reasoning block, no markdown marks.
export function clean(text) {
  return String(text)
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/\[\[[^\]]*(\]\]|$)/g, '') // her tags (read from the raw answer, never shown)
    .replace(/[*_`#]+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// Detect which browser was requested: 'chrome' or 'brave' (or null)
function detectBrowser(text) {
  if (/\b(?:en|con|usando|on|in|with)\s+chrome\b|\bgoogle\s+chrome\b|\bchrome\b/i.test(text)) return 'chrome';
  if (/\b(?:en|con|usando|on|in|with)\s+brave\b|\bbrave\b/i.test(text)) return 'brave';
  return null;
}

// A site from SITES or a URL/domain in the text: { name, url }, or null.
function namedSite(text) {
  // 1. Direct URL (http:// or https://)
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[0]);
      return { name: u.hostname.replace(/^www\./, ''), url: u.href };
    } catch { }
  }

  // 2. Domain pattern (e.g. gemini.google.com, x.com, github.com, etc.)
  const domainMatch = text.match(/\b([a-zA-Z0-9-]+\.(?:com|org|net|io|dev|app|gg|tv|es|me|ai|co|edu)(?:\/[^\s"'<>]*)?)\b/i);
  if (domainMatch) {
    try {
      const u = new URL('https://' + domainMatch[1]);
      return { name: u.hostname.replace(/^www\./, ''), url: u.href };
    } catch { }
  }

  // 3. Known names from SITES
  const name = Object.keys(SITES).find((n) => new RegExp(`\\b${n}\\b`, 'i').test(text));
  return name ? { name: new URL(SITES[name]).hostname.replace(/^www\./, ''), url: SITES[name] } : null;
}

// Whether your message asks for what her tag (its kind: open, music, media, site, close) would do.
function wanted(kind, text) {
  const music = MUSIC_WORD.test(text) || LISTEN.test(text);
  if (kind === 'music') return music;
  if (kind === 'media') return music || SOUND.test(text) || MEDIA_ASK.some(([, re]) => re.test(text));
  if (kind === 'site') return OPEN_ASK.test(text) || SITE.test(text);
  if (kind === 'close') return CLOSE_ASK.test(text);
  return OPEN_ASK.test(text) || PLAY.test(text) || DEV_ASK.test(text) || ACTION_ASK.test(text) || AI_CMD_ASK.test(text); // an app, or a game to play
}

// The app named by her close tag: [[close: AM Music]], or a sloppier [[close]] AM Music.
function tagged(text) {
  const tag = CLOSE_TAG.exec(text);
  if (!tag) return null;
  const name = tag[1].trim() || text.slice(tag.index + tag[0].length).split('\n')[0].replace(/^[\s:.]+|[\s.!]+$/g, '');
  return name || null;
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Her face for an answer.
export function mood(text) {
  if (/(ja){2,}|(ha){2,}|lol/i.test(text)) return 'laugh';
  if (text.includes('!')) return 'grin';
  if (text.trim().endsWith('?')) return 'smug';
  return 'look';
}
