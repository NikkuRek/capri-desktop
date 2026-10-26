'use strict';

// Cliente para Ollama local (https://ollama.com).
// Comunicación directa con el daemon de Ollama en Linux (127.0.0.1:11434).

function base() {
  let host = process.env.OLLAMA_HOST || '127.0.0.1:11434';
  if (!/^https?:\/\//.test(host)) host = `http://${host}`;
  return host.replace('://0.0.0.0', '://127.0.0.1').replace(/\/+$/, '');
}

async function failure(res) {
  const body = await res.text().catch(() => '');
  try {
    return new Error(JSON.parse(body).error);
  } catch {
    return new Error(body || `Ollama respondió con código ${res.status}`);
  }
}

// Lista los modelos instalados en Ollama ("llama3.2:latest", etc.)
async function models() {
  const res = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw await failure(res);
  const { models: list = [] } = await res.json();
  return list.map((m) => m.name);
}

// Carga previa del modelo en RAM/VRAM
function warm(model) {
  fetch(`${base()}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: '15m' }),
  }).catch(() => {});
}

// Streaming de respuesta de Ollama
async function chat({ model, messages }, onDelta, signal) {
  const res = await fetch(`${base()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model || process.env.OLLAMA_MODEL || 'llama3.2',
      messages,
      stream: true,
      keep_alive: '15m',
      options: { temperature: 0.85, num_predict: 240 },
    }),
    signal,
  });

  if (!res.ok) throw await failure(res);

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      const piece = msg.message?.content || '';
      if (piece) {
        text += piece;
        if (typeof onDelta === 'function') onDelta(piece);
      }
      if (msg.done) return text;
    }
  }
  return text;
}

module.exports = {
  base,
  models,
  warm,
  chat,
};
