'use strict';

// Despachador unificado de Inteligencia Artificial para Capri.
// Soporta Google Gemini Flash (3.5 / 2.5) y Llama 3 (Ollama local).

const gemini = require('./gemini');
const ollama = require('./ollama');
const localStt = require('./local-stt');
const memory = require('../memory');
const vision = require('../vision');
const web = require('../web');
const windows = require('../windows');

const SYSTEM_TOOLS = [
  {
    name: 'recordar_hecho',
    description: 'Guarda información importante y persistente sobre el usuario (preferencias, equipo, compras, relaciones, datos personales) en la memoria a largo plazo.',
    parameters: {
      type: 'object',
      properties: {
        concept: {
          type: 'string',
          description: "Tema o entidad principal (ej. 'PC', 'Mascota', 'Teclado').",
        },
        fact: {
          type: 'string',
          description: "El hecho detallado (ej. 'Tiene 24GB de RAM', 'Compró un teclado en MercadoLibre').",
        },
      },
      required: ['concept', 'fact'],
    },
  },
  {
    name: 'observar_camara',
    description: "Toma una fotografía instantánea usando la webcam del usuario para ver su entorno, objetos o a él mismo. Úsala SOLO cuando el usuario te pida explícitamente que mires algo físico ('mira esto', 'qué opinas de mi ropa', 'voltea a verme').",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'buscar_internet',
    description: 'Busca en internet información en tiempo real, precios, noticias o datos actualizados que no conoces. Usa esta herramienta cuando el usuario te pida buscar un producto, una noticia o resolver una duda que requiera acceso a la web.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "Los términos de búsqueda exactos y concisos para el buscador (ej. 'teclados mecánicos mercadolibre venezuela', 'precio del dólar hoy').",
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'controlar_entorno',
    description: 'Controla el entorno de escritorio del usuario. Permite listar ventanas abiertas, abrir programas, enfocar o cerrar ventanas, y cambiar de escritorio virtual.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['listar', 'abrir', 'enfocar', 'cerrar', 'workspace'],
          description: 'Acción a ejecutar sobre el entorno de escritorio.',
        },
        target: {
          type: 'string',
          description: "Nombre del programa a abrir (ej. 'alacritty', 'code', 'dolphin'), el ID de la ventana para enfocar/cerrar, o el número del workspace. Vacío si la acción es 'listar'.",
        },
      },
      required: ['action'],
    },
  },
];

function injectMemoryContext(messages = []) {
  const cloned = messages.map((m) => ({ ...m }));
  const lastUser = [...cloned].reverse().find((m) => m.role === 'user');
  const userPrompt = typeof lastUser?.content === 'string' ? lastUser.content : '';
  if (!userPrompt) return cloned;

  const recalledFacts = memory.recallContext(userPrompt);
  if (!recalledFacts) return cloned;

  const block = `\n\n[CONTEXTO DE MEMORIA A LARGO PLAZO]\n${recalledFacts}\nUsa esta información de forma sutil y natural en tu respuesta solo si es estrictamente relevante.`;
  const sysIndex = cloned.findIndex((m) => m.role === 'system');
  if (sysIndex >= 0) {
    cloned[sysIndex].content = `${cloned[sysIndex].content || ''}${block}`;
  } else {
    cloned.unshift({ role: 'system', content: block.trim() });
  }
  return cloned;
}

async function handleToolCall(name, args = {}) {
  if (name === 'recordar_hecho') {
    const saved = memory.saveFact(args.concept, args.fact);
    return {
      status: saved ? 'success' : 'error',
      message: saved ? 'Hecho recordado en SQLite' : 'No se pudo guardar el hecho en SQLite',
    };
  }
  if (name === 'observar_camara') {
    const frame = await vision.captureFrame();
    if (!frame.ok) {
      return {
        status: 'error',
        message: frame.error || 'No se pudo capturar el fotograma de la webcam.',
      };
    }
    return {
      status: 'success',
      message: 'Fotograma capturado desde la webcam.',
      image: {
        mimeType: frame.mimeType || 'image/jpeg',
        base64: frame.base64,
      },
    };
  }
  if (name === 'buscar_internet') {
    const query = String(args?.query ?? '').trim();
    if (!query) {
      return { status: 'error', message: 'No se proporcionó el parámetro query para buscar en internet.' };
    }
    const text = await web.searchWeb(query);
    return {
      status: text.startsWith('Error al buscar') ? 'error' : 'success',
      message: text,
    };
  }
  if (name === 'controlar_entorno') {
    const action = String(args?.action ?? '').toLowerCase().trim();
    if (action === 'listar') {
      const list = windows.getWindows();
      return {
        status: 'success',
        message: JSON.stringify(list),
      };
    }
    const res = windows.manage(action, args?.target);
    return {
      status: res.ok ? 'success' : 'error',
      message: res.ok ? res.message : res.error,
    };
  }
  return { status: 'error', message: `Herramienta no soportada: ${name}` };
}

function resolveProvider(cfg = {}) {
  if (cfg.aiProvider === 'gemini' || cfg.aiProvider === 'ollama') {
    return cfg.aiProvider;
  }
  // Si no está especificado explícitamente, preferir Gemini si hay API key configurada
  return gemini.getApiKey() ? 'gemini' : 'ollama';
}

async function status(cfg = {}) {
  const provider = resolveProvider(cfg);

  if (provider === 'gemini') {
    const s = await gemini.checkStatus();
    return {
      ...s,
      provider: 'gemini',
      model: s.model || gemini.getModel(),
    };
  }

  // Ollama local
  try {
    const list = await ollama.models();
    if (!list.length) {
      return { ok: false, provider: 'ollama', error: 'no_model', model: 'llama3.2:1b' };
    }
    const chosen = list.find((m) => m.includes('1b')) || list.find((m) => m.startsWith('llama3.2')) || list[0];
    ollama.warm(chosen);
    return { ok: true, provider: 'ollama', model: chosen, list };
  } catch (err) {
    return { ok: false, provider: 'ollama', error: 'offline', message: err.message, model: 'llama3.2:1b' };
  }
}

async function chat({ messages, provider: reqProvider, model, onToolStatus }, onDelta, signal) {
  const provider = reqProvider || (gemini.getApiKey() ? 'gemini' : 'ollama');
  const enrichedMessages = injectMemoryContext(messages);

  const notifyToolCall = async (name, args) => {
    try {
      onToolStatus?.({ tool: name, status: 'started' });
      return await handleToolCall(name, args);
    } finally {
      onToolStatus?.({ tool: name, status: 'finished' });
    }
  };

  if (provider === 'gemini') {
    return gemini.chat(
      { messages: enrichedMessages, model, tools: SYSTEM_TOOLS, onToolCall: notifyToolCall },
      onDelta,
      signal
    );
  } else {
    return ollama.chat(
      { messages: enrichedMessages, model, tools: SYSTEM_TOOLS, onToolCall: notifyToolCall },
      onDelta,
      signal
    );
  }
}

function warmOllama() {
  ollama.models().then((list) => {
    if (list && list.length) {
      const chosen = list.find((m) => m.includes('1b')) || list.find((m) => m.startsWith('llama3.2')) || list[0];
      ollama.warm(chosen);
      console.log(`[capri:ollama] Modelo liviano ${chosen} inicializado.`);
    }
  }).catch(() => {});
}

async function transcribeAudio({ base64 }) {
  if (!base64) {
    throw new Error('No se recibió audio para transcribir.');
  }
  const audioBuffer = Buffer.from(base64, 'base64');
  return localStt.transcribeLocal(audioBuffer);
}

module.exports = {
  resolveProvider,
  status,
  chat,
  transcribeAudio,
  warmOllama,
  gemini,
  ollama,
  localStt,
};
