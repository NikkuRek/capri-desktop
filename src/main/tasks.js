'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { gemini, ollama, resolveProvider } = require('./ai');
const config = require('./config');

const DEV_DIR = '/run/media/nikkurek/FILES/dev';
const FALLBACK_DIR = '/run/media/nikkurek/FILES/dev/tareas';

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'tareas';
}

function matchDevProject(text) {
  if (!fs.existsSync(DEV_DIR)) return null;
  const raw = String(text || '').toLowerCase();

  const projMatch = raw.match(/(?:proyecto|repo|carpeta)\s+([a-z0-9_-]+)/i);
  const candidate = projMatch ? projMatch[1] : null;

  try {
    const entries = fs.readdirSync(DEV_DIR, { withFileTypes: true });
    if (candidate && candidate !== 'de' && candidate !== 'del') {
      const found = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === candidate);
      if (found) {
        return { name: found.name, dir: path.join(DEV_DIR, found.name) };
      }
    }

    const ignoreWords = new Set(['proyecto', 'project', 'app', 'pruebas', 'prueba', 'test', 'tareas']);
    const sorted = entries
      .filter((e) => e.isDirectory() && !ignoreWords.has(e.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length);

    for (const entry of sorted) {
      const nameLower = entry.name.toLowerCase();
      const re = new RegExp(`\\b${nameLower.replace(/[-_]/g, '[-_\\s]?')}\\b`, 'i');
      if (re.test(raw)) {
        return {
          name: entry.name,
          dir: path.join(DEV_DIR, entry.name),
        };
      }
    }
  } catch {}
  return null;
}

async function generateTasksMd({ text }) {
  const reqText = String(text || '').trim();
  if (!reqText) {
    return { ok: false, error: 'Peticion vacia' };
  }

  const proj = matchDevProject(reqText);
  const targetDir = proj ? proj.dir : FALLBACK_DIR;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Nombre de archivo apropiado
  let filename = 'TASKS.md';
  if (!proj) {
    const cleanTopic = reqText
      .replace(/^(?:crea|haz|genera|escribe|crear|hacer|generar)\s+(?:un\s+)?(?:documento|archivo|lista)?\s*(?:md|markdown|de\s+tareas|con\s+las?\s+tareas?|tasks?)\s*(?:de|del|para|sobre)?/i, '')
      .trim();
    const slug = slugify(cleanTopic);
    filename = `tareas-${slug}.md`;
  }

  let filePath = path.join(targetDir, filename);
  if (fs.existsSync(filePath) && proj) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const altName = `TASKS-${dateStr}.md`;
    if (!fs.existsSync(path.join(targetDir, altName))) {
      filePath = path.join(targetDir, altName);
      filename = altName;
    }
  }

  const cfg = config.load();
  const provider = resolveProvider(cfg);

  // Prompt ultracompacto para minimizar consumo de tokens
  const systemInstruction = 'Genera exclusivamente una lista de tareas en Markdown limpio y estructurado. Usa titulos, casillas "- [ ]" y subtareas claras y accionables. No agregues introducciones, saludos ni textos de cierre.';

  let markdownContent = '';

  if (provider === 'gemini') {
    const apiKey = gemini.getApiKey();
    if (!apiKey) {
      return { ok: false, error: 'Falta GEMINI_API_KEY en .env' };
    }

    const candidateModels = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', gemini.getModel()];
    let lastError = null;

    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: reqText }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
      };

      try {
        let res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.status === 400) {
          delete payload.generationConfig.thinkingConfig;
          res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        if (res.ok) {
          const json = await res.json();
          markdownContent = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (markdownContent.trim()) break;
        } else {
          lastError = `${res.status} ${await res.text().catch(() => '')}`;
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!markdownContent.trim()) {
      return { ok: false, error: `Error generando tareas con Gemini: ${lastError}` };
    }
  } else {
    // Ollama local (0 tokens de API)
    const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:1b';
    const messages = [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: reqText },
    ];
    let collected = '';
    await ollama.chat({ model: ollamaModel, messages }, (chunk) => {
      collected += chunk;
    });
    markdownContent = collected;
  }

  if (!markdownContent.trim()) {
    return { ok: false, error: 'No se pudo generar contenido de tareas' };
  }

  fs.writeFileSync(filePath, markdownContent.trim() + '\n', 'utf8');

  return {
    ok: true,
    path: filePath,
    filename,
    project: proj ? proj.name : null,
    linesCount: markdownContent.split('\n').length,
  };
}

module.exports = {
  generateTasksMd,
};
