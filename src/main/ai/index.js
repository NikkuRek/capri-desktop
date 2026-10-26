'use strict';

// Despachador unificado de Inteligencia Artificial para Capri.
// Soporta Google Gemini Flash (3.5 / 2.5) y Llama 3 (Ollama local).

const gemini = require('./gemini');
const ollama = require('./ollama');

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
      return { ok: false, provider: 'ollama', error: 'no_model', model: 'llama3' };
    }
    const chosen = list.find((m) => m.startsWith('llama3')) || list[0];
    ollama.warm(chosen);
    return { ok: true, provider: 'ollama', model: chosen, list };
  } catch (err) {
    return { ok: false, provider: 'ollama', error: 'offline', message: err.message, model: 'llama3' };
  }
}

async function chat({ messages, provider: reqProvider, model }, onDelta, signal) {
  const provider = reqProvider || (gemini.getApiKey() ? 'gemini' : 'ollama');

  if (provider === 'gemini') {
    return gemini.chat({ messages, model }, onDelta, signal);
  } else {
    return ollama.chat({ messages, model }, onDelta, signal);
  }
}

module.exports = {
  resolveProvider,
  status,
  chat,
  gemini,
  ollama,
};
