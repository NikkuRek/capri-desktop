'use strict';

// Cliente para Google Gemini Flash API.
// Conexión directa mediante REST API oficial de Google AI Studio con soporte streaming (SSE).
// Utiliza la API Key provista en el archivo .env.

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === '' || key === 'tu_api_key_aqui') {
    return null;
  }
  return key.trim();
}

function getModel() {
  return process.env.GEMINI_MODEL || 'gemini-3.5-flash';
}

async function failure(res) {
  const body = await res.text().catch(() => '');
  try {
    const json = JSON.parse(body);
    return new Error(json.error?.message || `Gemini API respondió con código ${res.status}`);
  } catch {
    return new Error(body || `Gemini API error ${res.status}`);
  }
}

// Verifica si la API Key está configurada y accesible
async function checkStatus() {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: 'no_key',
      message: 'Falta configurar GEMINI_API_KEY en el archivo .env',
      model: getModel(),
    };
  }

  try {
    const model = getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return { ok: false, error: 'invalid_key', model };
    }
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: 'network', message: err.message, model: getModel() };
  }
}

// Transforma el historial de mensajes [ { role: 'user'|'assistant'|'system', content } ]
// al formato de Gemini Contents y SystemInstruction
function formatGeminiPayload(messages, { disableThinking = true } = {}) {
  let systemText = '';
  const contents = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemText = systemText ? `${systemText}\n\n${msg.content}` : msg.content;
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  // Gemini requiere al menos un mensaje de usuario si contents está vacío
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hola' }] });
  }

  const generationConfig = {
    temperature: 0.75,
    maxOutputTokens: 2048,
  };

  // Desactivar el thinking interno para modelos como Gemini 2.5/3.5 Flash en chat conversacional rápido
  if (disableThinking) {
    generationConfig.thinkingConfig = {
      thinkingBudget: 0,
    };
  }

  const payload = {
    contents,
    generationConfig,
  };

  if (systemText) {
    payload.systemInstruction = {
      parts: [{ text: systemText }],
    };
  }

  return payload;
}

// Envío de mensaje a Gemini con streaming de respuestas en tiempo real
async function chat({ messages, model: modelOverride }, onDelta, signal) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No se encontró GEMINI_API_KEY. Configura tu clave en el archivo .env.');
  }

  const model = modelOverride || getModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  let payload = formatGeminiPayload(messages, { disableThinking: true });
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  // Si el modelo rechaza thinkingConfig (400), reintentamos sin thinkingConfig
  if (res.status === 400) {
    const errorBody = await res.clone().text().catch(() => '');
    if (errorBody.includes('thinkingConfig') || errorBody.includes('thinkingBudget')) {
      payload = formatGeminiPayload(messages, { disableThinking: false });
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
    }
  }

  if (!res.ok) throw await failure(res);

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let finishReason = null;

  function processLine(line) {
    if (!line.startsWith('data: ')) return;
    const rawJson = line.slice(6).trim();
    if (!rawJson || rawJson === '[DONE]') return;
    try {
      const parsed = JSON.parse(rawJson);
      const candidate = parsed.candidates?.[0];
      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
      }
      if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
        for (const part of candidate.content.parts) {
          if (part && typeof part.text === 'string' && part.text.length > 0) {
            fullText += part.text;
            if (typeof onDelta === 'function') {
              onDelta(part.text);
            }
          }
        }
      }
    } catch {
      // Fragmento no parseable, omitir
    }
  }

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      processLine(line);
    }
  }

  // Procesar cualquier línea remanente en el buffer
  if (buffer.trim()) {
    processLine(buffer.trim());
  }

  if (!fullText.trim()) {
    if (finishReason === 'SAFETY') {
      throw new Error('La respuesta fue bloqueada por filtros de seguridad de Gemini.');
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini agotó el límite de tokens antes de emitir la respuesta.');
    }
    throw new Error('Gemini no generó texto en su respuesta.');
  }

  return fullText;
}

module.exports = {
  getApiKey,
  getModel,
  checkStatus,
  chat,
};


