'use strict';

const os = require('node:os');

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

function getKeepAlive() {
  const envVal = process.env.OLLAMA_KEEP_ALIVE;
  if (envVal !== undefined && envVal !== '') {
    const num = Number(envVal);
    return isNaN(num) ? envVal : num;
  }
  return '5m'; // Se descarga automáticamente de RAM tras 5 minutos sin uso para no saturar la CPU
}

// Lista los modelos instalados en Ollama ("llama3.2:1b", etc.)
async function models() {
  const res = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw await failure(res);
  const { models: list = [] } = await res.json();
  return list.map((m) => m.name);
}

function localOptions() {
  const threads = Math.max(2, os.cpus().length);
  return {
    temperature: 0.75,
    num_predict: 80,
    num_ctx: 512,
    num_thread: threads,
  };
}

// Carga previa del modelo en RAM/VRAM de forma eficiente
function warm(model) {
  const m = model || process.env.OLLAMA_MODEL || 'llama3.2:1b';
  return fetch(`${base()}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: m, keep_alive: getKeepAlive(), options: localOptions() }),
  }).catch((err) => {
    console.warn('[capri:ollama] No se pudo precargar modelo:', err.message);
  });
}

function toOllamaTools(tools = []) {
  if (!tools.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// Streaming de respuesta de Ollama con persistencia eficiente y soporte Tool Calling
async function chat({ model, messages, tools = [], onToolCall }, onDelta, signal) {
  const chosenModel = model || process.env.OLLAMA_MODEL || 'llama3.2:1b';
  const conversation = [...messages];
  const MAX_TOOL_TURNS = 3;
  let fullText = '';
  let useTools = tools.length > 0;

  for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
    const opts = localOptions();
    if (useTools && opts.num_ctx < 768) {
      opts.num_ctx = 768;
    }

    const body = {
      model: chosenModel,
      messages: conversation,
      stream: true,
      keep_alive: getKeepAlive(),
      options: opts,
    };
    const ollamaTools = useTools ? toOllamaTools(tools) : undefined;
    if (ollamaTools) body.tools = ollamaTools;

    let res = await fetch(`${base()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    // Si el modelo local no soporta tools, reintentar sin tools para no romper el chat
    if (res.status === 400 && useTools) {
      const errText = await res.clone().text().catch(() => '');
      if (/does not support tools/i.test(errText)) {
        useTools = false;
        delete body.tools;
        res = await fetch(`${base()}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      }
    }

    if (!res.ok) throw await failure(res);

    const decoder = new TextDecoder();
    let buffer = '';
    let turnText = '';
    const toolCalls = [];

    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.error) throw new Error(msg.error);

        if (Array.isArray(msg.message?.tool_calls) && msg.message.tool_calls.length > 0) {
          toolCalls.push(...msg.message.tool_calls);
        }

        const piece = msg.message?.content || '';
        if (piece) {
          turnText += piece;
          fullText += piece;
          if (typeof onDelta === 'function') onDelta(piece);
        }
        if (msg.done) break;
      }
    }

    if (toolCalls.length > 0 && typeof onToolCall === 'function' && turn < MAX_TOOL_TURNS) {
      conversation.push({
        role: 'assistant',
        content: turnText || '',
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let args = tc.function?.arguments || {};
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        const result = await onToolCall(name, args);
        const { image, ...jsonResult } = result || {};
        conversation.push({
          role: 'tool',
          content: JSON.stringify(jsonResult),
        });
        if (image?.base64) {
          conversation.push({
            role: 'user',
            content: 'Aquí está la imagen capturada desde la webcam. Úsala para responderle al usuario.',
            images: [image.base64],
          });
        }
      }
      continue;
    }

    return fullText;
  }

  return fullText;
}

module.exports = {
  base,
  models,
  warm,
  chat,
};
