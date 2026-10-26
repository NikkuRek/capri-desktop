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
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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
      // Si el modelo 2.5 no está disponible o falla, intentamos verificar si la clave es válida con 1.5
      return { ok: false, error: 'invalid_key', model };
    }
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: 'network', message: err.message, model: getModel() };
  }
}

// Transforma el historial de mensajes [ { role: 'user'|'assistant'|'system', content } ]
// al formato de Gemini Contents y SystemInstruction
function formatGeminiPayload(messages) {
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

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 320,
    },
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
  const payload = formatGeminiPayload(messages);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) throw await failure(res);

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);

      if (line.startsWith('data: ')) {
        const rawJson = line.slice(6).trim();
        if (!rawJson || rawJson === '[DONE]') continue;
        try {
          const parsed = JSON.parse(rawJson);
          const piece = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (piece) {
            fullText += piece;
            if (typeof onDelta === 'function') {
              onDelta(piece);
            }
          }
        } catch {
          // Fragmento no parseable, omitir
        }
      }
    }
  }

  return fullText;
}

module.exports = {
  getApiKey,
  getModel,
  checkStatus,
  chat,
};
