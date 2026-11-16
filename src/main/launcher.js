'use strict';

// Lanzador de aplicaciones y comandos de terminal para Linux (Niri Wayland).
// Descubre aplicaciones .desktop de sistema y Flatpak, aliases conocidos y comandos en PATH.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');
const commandsConfig = require('./commands');

const DESKTOP_DIRS = [
  '/usr/share/applications',
  '/var/lib/flatpak/exports/share/applications',
  path.join(os.homedir(), '.local/share/applications'),
  path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
];

const CLI_TOOLS = new Set([
  'htop', 'btop', 'top', 'fastfetch', 'neofetch', 'cmatrix', 'nvtop', 'ranger', 'yazi',
  'lazygit', 'ncdu', 'git', 'vim', 'nvim', 'nano', 'tmux', 'bash', 'zsh', 'fish',
  'docker', 'docker-compose', 'podman', 'pacman', 'yay', 'paru', 'flatpak', 'systemctl',
  'journalctl', 'ssh', 'ping', 'curl', 'wget', 'cargo', 'npm', 'pnpm', 'yarn', 'bun',
  'deno', 'pip', 'python', 'python3', 'node', 'make', 'gcc', 'clang', 'rustc', 'go',
  'tailscale', 'cachyos-rate-mirrors', 'ls', 'grep', 'find', 'cat', 'tree', 'ps', 'kill',
  'pkill', 'df', 'free', 'ip', 'iproute2', 'netstat', 'ss', 'dmesg', 'uname',
]);

const DEV_DIR = process.env.DEV_DIR || '/run/media/nikkurek/FILES/dev';
const DEV_SELECTOR_SCRIPT = path.join(os.homedir(), '.local/bin/dev-selector.sh');

const ALIASES = {
  chrome: { name: 'Google Chrome', command: 'flatpak run --command=/app/bin/chrome com.google.Chrome' },
  'google chrome': { name: 'Google Chrome', command: 'flatpak run --command=/app/bin/chrome com.google.Chrome' },
  brave: { name: 'Brave Browser', command: 'brave' },
  'brave browser': { name: 'Brave Browser', command: 'brave' },
  'Navegador': { name: 'Brave Browser', command: 'brave' },
  dolphin: { name: 'Dolphin', command: 'dolphin' },
  explorador: { name: 'Dolphin', command: 'dolphin' },
  archivos: { name: 'Dolphin', command: 'dolphin' },
  terminal: { name: 'Kitty', command: 'kitty' },
  consola: { name: 'Kitty', command: 'kitty' },
  kitty: { name: 'Kitty', command: 'kitty' },
  alacritty: { name: 'Alacritty', command: 'alacritty' },
  antigravity: { name: 'Antigravity IDE', command: 'antigravity-ide' },
  'antigravity ide': { name: 'Antigravity IDE', command: 'antigravity-ide' },
  agy: { name: 'Antigravity IDE', command: 'antigravity-ide' },
  ferdium: { name: 'Ferdium', command: 'flatpak run org.ferdium.Ferdium' },
  discord: { name: 'Ferdium', command: 'flatpak run org.ferdium.Ferdium' },
  proyectos: { name: 'Selector de Proyectos', command: DEV_SELECTOR_SCRIPT },
  'proyectos recientes': { name: 'Selector de Proyectos', command: DEV_SELECTOR_SCRIPT },
  'selector de proyectos': { name: 'Selector de Proyectos', command: DEV_SELECTOR_SCRIPT },
  'ver proyectos': { name: 'Selector de Proyectos', command: DEV_SELECTOR_SCRIPT },
  'mis proyectos': { name: 'Selector de Proyectos', command: DEV_SELECTOR_SCRIPT },
  'lista de proyectos': { name: 'Selector de Proyectos', command: DEV_SELECTOR_SCRIPT },
  wofi: { name: 'Wofi', command: 'wofi --show drun' },
};

let cachedApps = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

function cleanExec(exec) {
  if (!exec) return '';
  return exec
    .replace(/@@u\s+%U\s+@@/g, '')
    .replace(/@@[a-z]\s+%[a-z]\s+@@/gi, '')
    .replace(/%[a-zA-Z]/g, '')
    .trim();
}

function parseDesktopFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let inDesktopEntry = false;
    let name = '';
    let exec = '';
    let terminal = false;
    let noDisplay = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('[')) {
        inDesktopEntry = line === '[Desktop Entry]';
        continue;
      }
      if (!inDesktopEntry || line.startsWith('#') || !line.includes('=')) continue;

      const [key, ...vals] = line.split('=');
      const val = vals.join('=').trim();

      if (key === 'Name' && !name) name = val;
      else if (key === 'Exec' && !exec) exec = val;
      else if (key === 'Terminal') terminal = val.toLowerCase() === 'true';
      else if (key === 'NoDisplay') noDisplay = val.toLowerCase() === 'true';
    }

    if (!name || !exec || noDisplay) return null;

    return {
      id: path.basename(filePath, '.desktop'),
      name,
      exec: cleanExec(exec),
      terminal,
      path: filePath,
    };
  } catch {
    return null;
  }
}

function scanApps() {
  const now = Date.now();
  if (cachedApps && now - cacheTime < CACHE_TTL) return cachedApps;

  const apps = [];
  const seenIds = new Set();

  for (const dir of DESKTOP_DIRS) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.desktop')) continue;
        const fullPath = path.join(dir, file);
        const app = parseDesktopFile(fullPath);
        if (app && !seenIds.has(app.id.toLowerCase())) {
          seenIds.add(app.id.toLowerCase());
          apps.push(app);
        }
      }
    } catch (err) {
      console.error(`[capri:launcher] Error escaneando ${dir}:`, err.message);
    }
  }

  cachedApps = apps;
  cacheTime = now;
  return apps;
}

const normalize = (str) =>
  String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

let cachedProjects = null;
let projectCacheTime = 0;
const PROJECT_CACHE_TTL = 30 * 1000;

function scanDevProjects() {
  const now = Date.now();
  if (cachedProjects && now - projectCacheTime < PROJECT_CACHE_TTL) {
    return cachedProjects;
  }
  const projects = [];
  if (fs.existsSync(DEV_DIR)) {
    try {
      const entries = fs.readdirSync(DEV_DIR, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && !ent.name.startsWith('.')) {
          const norm = normalize(ent.name);
          projects.push({
            name: ent.name,
            path: path.join(DEV_DIR, ent.name),
            normalized: norm,
            compact: norm.replace(/\s+/g, ''),
          });
        }
      }
    } catch (err) {
      console.error('[capri:launcher] Error escaneando proyectos dev:', err.message);
    }
  }
  cachedProjects = projects;
  projectCacheTime = now;
  return projects;
}

function matchDevProject(rawText) {
  const projects = scanDevProjects();
  if (!projects.length) return null;

  let cleaned = String(rawText || '').trim();

  // 1. Quitar saludos / peticiones y verbos de apertura
  cleaned = cleaned
    .replace(/^(?:por\s+favor\s+|podr[ií]as\s+|quiero\s+que\s+)?/i, '')
    .replace(/^(?:abre|abrir|ábreme|abreme|inicia|iniciar|lanza|lanzar|cargar|carga|open|launch|start)\s+/i, '')
    .replace(/[.!?¿¡]+$/g, '')
    .trim();

  // 2. Detectar mención explícita a agy / antigravity
  let explicitAgy = false;
  if (/(?:\s+(?:en|con)\s+(?:agy|antigravity(?:\s+ide)?)|^(?:agy|antigravity(?:\s+ide)?)\s+)/i.test(cleaned)) {
    explicitAgy = true;
    cleaned = cleaned
      .replace(/\s+(?:en|con)\s+(?:agy|antigravity(?:\s+ide)?)$/i, '')
      .replace(/^(?:agy|antigravity(?:\s+ide)?)\s+/i, '')
      .trim();
  }

  // 3. Detectar mención a "proyecto" / "carpeta" / "repo"
  let explicitProject = false;
  if (/^(?:el\s+|mi\s+|los\s+)?(?:proyecto|carpeta|repositorio|repo)\s+/i.test(cleaned)) {
    explicitProject = true;
    cleaned = cleaned.replace(/^(?:el\s+|mi\s+|los\s+)?(?:proyecto|carpeta|repositorio|repo)\s+/i, '').trim();
  }

  cleaned = cleaned.replace(/^(?:la|el|los|las|un|una|mi)\s+/i, '').trim();

  const normTarget = normalize(cleaned);
  const compactTarget = normTarget.replace(/\s+/g, '');
  if (!normTarget) return null;

  // 4. Coincidencia exacta por nombre normalizado, compacto o exacto
  let match = projects.find((p) =>
    p.normalized === normTarget ||
    p.compact === compactTarget ||
    p.name.toLowerCase() === cleaned.toLowerCase()
  );

  // 5. Coincidencia con separadores (- / _)
  if (!match) {
    const dashed = normTarget.replace(/\s+/g, '-');
    const underscored = normTarget.replace(/\s+/g, '_');
    match = projects.find((p) => {
      const lower = p.name.toLowerCase();
      return lower === dashed || lower === underscored;
    });
  }

  // 6. Coincidencia parcial si se mencionó explícitamente agy/antigravity/proyecto o target >= 4 caracteres
  if (!match && (explicitAgy || explicitProject || normTarget.length >= 4)) {
    // Si el texto incluye verbos o comandos de terminal (docker, git, npm, etc.), no es apertura de proyecto en IDE
    if (/\b(?:docker|compose|git|npm|pnpm|yarn|cargo|pip|build|start|stop|up|down|status|push|pull|run)\b/i.test(cleaned)) {
      return null;
    }
    match = projects.find((p) => {
      // Ignorar carpeta genérica "Proyecto" para búsquedas parciales
      if (p.normalized === 'proyecto') return normTarget === 'proyecto';
      if (p.compact.length >= 3 && compactTarget.length >= 3) {
        if (p.compact === compactTarget || p.compact.startsWith(compactTarget) || p.compact.includes(compactTarget)) {
          return true;
        }
      }
      return p.normalized === normTarget || p.normalized.startsWith(normTarget) || p.normalized.includes(normTarget);
    });
  }

  if (match) {
    return {
      id: `proj-${match.name}`,
      name: `Proyecto ${match.name}`,
      command: `antigravity-ide "${match.path}"`,
      inTerminal: false,
      kind: 'project',
      projectPath: match.path,
    };
  }

  return null;
}

let aiModule = null;
function getAi() {
  if (!aiModule) {
    try {
      aiModule = require('./ai');
    } catch (err) {
      console.warn('[capri:launcher] No se pudo cargar módulo AI:', err.message);
    }
  }
  return aiModule;
}

async function resolveCommandWithAI(promptText) {
  const ai = getAi();
  if (!ai) return null;

  try {
    const devProjects = scanDevProjects().map((p) => p.name).join(', ');
    const systemPrompt = `Eres el asistente de terminal Bash para Capri Desktop en CachyOS Linux (Arch Linux).
Entorno de ejecución:
- Usuario: ${os.userInfo().username || 'nikkurek'}
- Home: ${os.homedir()}
- Directorio de desarrollo: ${DEV_DIR}
- Proyectos disponibles: ${devProjects}
- Terminal gráfica: Kitty
- Shell: Bash / Fish

Tu tarea es traducir la orden en lenguaje natural del usuario en el comando exacto de Bash.
Reglas estrictas:
1. Si menciona un proyecto (ej: "del proyecto X", "en el proyecto X", "en X"), antepón la navegación al directorio: cd "${DEV_DIR}/<nombre_exacto_proyecto>" && <comando>.
2. El comando debe ser ejecutable directamente en bash.
3. Si el comando necesita permisos de root (ej: instalar, reiniciar servicios), usa sudo.
4. Responde ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "command": "comando bash a ejecutar",
  "explanation": "breve descripción de lo que hace en español (máx 8 palabras)",
  "inTerminal": true,
  "risky": false
}
5. Marca risky: true solo si es un comando destructivo irreversible (rm -rf /, mkfs, dd).
No agregues explicaciones fuera del JSON, no uses bloques de código markdown.`;

    const cleanInput = String(promptText || '')
      .replace(/^(?:ejecuta|corre|exec|run|comando|terminal)\s*[:]?\s*/i, '')
      .trim();

    if (!cleanInput) return null;

    const rawRes = await ai.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: cleanInput },
      ],
    });

    const text = typeof rawRes === 'string' ? rawRes : rawRes?.text || '';
    const cleanedJson = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const jsonMatch = cleanedJson.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed || !parsed.command) return null;

    return {
      id: 'cmd-ai',
      name: parsed.explanation || parsed.command,
      command: parsed.command,
      inTerminal: parsed.inTerminal !== false,
      kind: 'ai-terminal',
      risky: Boolean(parsed.risky),
    };
  } catch (err) {
    console.error('[capri:launcher] Error resolviendo comando con IA:', err.message);
    return null;
  }
}

function findExecutableInPath(bin) {
  try {
    const out = execSync(`which ${JSON.stringify(bin)} 2>/dev/null`, { encoding: 'utf8', timeout: 500 }).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function findStatic(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  // 1. Detectar si se pide explícitamente ejecutar un comando en la terminal
  const termMatch = text.match(/(?:ejecuta|corre|lanzar?|run|exec)\s+(?:en\s+(?:la\s+)?(?:terminal|consola)\s*[:]?\s*|(?:el\s+)?comando\s*[:]?\s*)(.+)/i);
  if (termMatch && termMatch[1]) {
    const cmd = termMatch[1].trim().replace(/^[`'"]|[`'"]$/g, '');
    return {
      id: 'cmd-terminal',
      name: cmd,
      command: cmd,
      inTerminal: true,
      kind: 'terminal',
    };
  }

  // 2. Extraer nombre eliminando verbos de apertura, acción y artículos
  let query = text
    .replace(/^(?:por\s+favor\s+|podr[ií]as\s+|quiero\s+que\s+)?/i, '')
    .replace(/^(?:actualiza|actualizar|update|upgrade|conecta|conectar|conéctame|conectame|desconecta|desconectar|limpia|limpiar|limpieza|libera|liberar|optimiza|optimizar|abre|abrir|ábreme|abreme|inicia|iniciar|lanza|lanzar|ejecuta|ejecutar|corre|correr|open|launch|start|run)\s+/i, '')
    .replace(/^(?:la|el|los|las|un|una|mi|app|aplicaci[oó]n|programa|comando)\s+/i, '')
    .replace(/[.!?¿¡]+$/g, '')
    .trim();

  const key = normalize(query);
  if (!key) return null;

  // 3. Comprobar aliases rápidos
  if (ALIASES[key]) {
    const a = ALIASES[key];
    return {
      id: `alias-${key}`,
      name: a.name,
      command: a.command,
      inTerminal: Boolean(a.inTerminal),
      kind: 'app',
    };
  }

  // 3.5. Comprobar proyectos de desarrollo en /run/media/nikkurek/FILES/dev
  const devProj = matchDevProject(text) || matchDevProject(query);
  if (devProj) {
    return devProj;
  }

  // 4. Comprobar config/commands.json
  const customMap = commandsConfig.loadCommandMap();
  const rawKey = normalize(text);
  const escapeRegex = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

  // Fase 1: Coincidencia EXACTA por ID, Label o Alias
  for (const cmd of Object.values(customMap)) {
    const cmdIdNorm = normalize(cmd.id);
    const cmdLabelNorm = normalize(cmd.label);
    if (cmdIdNorm === key || cmdIdNorm === rawKey || cmdLabelNorm === key || cmdLabelNorm === rawKey) {
      return {
        id: cmd.id,
        name: cmd.label,
        command: cmd.command,
        args: cmd.args || [],
        inTerminal: Boolean(cmd.inTerminal),
        kind: 'command',
      };
    }
    if (Array.isArray(cmd.aliases)) {
      for (const al of cmd.aliases) {
        const aNorm = normalize(al);
        if (aNorm === key || aNorm === rawKey) {
          return {
            id: cmd.id,
            name: cmd.label,
            command: cmd.command,
            args: cmd.args || [],
            inTerminal: Boolean(cmd.inTerminal),
            kind: 'command',
          };
        }
      }
    }
  }

  // Fase 2: Coincidencia de palabras completas en alias o label
  for (const cmd of Object.values(customMap)) {
    const cmdLabelNorm = normalize(cmd.label);
    if (cmdLabelNorm.includes(key) || cmdLabelNorm.includes(rawKey)) {
      return {
        id: cmd.id,
        name: cmd.label,
        command: cmd.command,
        args: cmd.args || [],
        inTerminal: Boolean(cmd.inTerminal),
        kind: 'command',
      };
    }
    if (Array.isArray(cmd.aliases)) {
      for (const al of cmd.aliases) {
        const aNorm = normalize(al);
        const re = new RegExp('(?:^|\\s)' + escapeRegex(aNorm) + '(?:\\s|$)');
        if (re.test(key) || re.test(rawKey)) {
          return {
            id: cmd.id,
            name: cmd.label,
            command: cmd.command,
            args: cmd.args || [],
            inTerminal: Boolean(cmd.inTerminal),
            kind: 'command',
          };
        }
      }
    }
  }

  // 5. Comprobar aplicaciones instaladas (.desktop)
  const apps = scanApps();
  const exact = apps.find((a) => normalize(a.name) === key || normalize(a.id) === key);
  if (exact) {
    return {
      id: exact.id,
      name: exact.name,
      command: exact.exec,
      inTerminal: exact.terminal,
      kind: 'app',
    };
  }

  // Búsqueda por inclusión de palabras
  const candidate = apps.find((a) => {
    const n = normalize(a.name);
    const id = normalize(a.id);
    return n.includes(key) || id.includes(key) || key.includes(n);
  });
  if (candidate) {
    return {
      id: candidate.id,
      name: candidate.name,
      command: candidate.exec,
      inTerminal: candidate.terminal,
      kind: 'app',
    };
  }

  // 6. Comprobar si es un binario disponible en PATH (solo si no contiene lenguaje natural de petición)
  const hasNaturalLanguage = /\b(?:de|del|en|el|la|los|las|un|una|mi|mis|proyecto|carpeta|que|para|por)\b/i.test(query);
  if (!hasNaturalLanguage) {
    const binPath = findExecutableInPath(query.split(' ')[0]);
    if (binPath) {
      const isCli = CLI_TOOLS.has(path.basename(binPath).toLowerCase()) || /^(?:ejecuta|corre|exec|run)\s+/i.test(text);
      return {
        id: `bin-${path.basename(binPath)}`,
        name: query,
        command: query,
        inTerminal: isCli,
        kind: 'bin',
      };
    }
  }

  return null;
}

async function find(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  // 0. Si usa disparador explícito "Ejecuta: ..." / "Corre: ..."
  const explicitAiMatch = text.match(/^(?:ejecuta|corre|exec|run|comando|terminal)\s*:\s*(.+)/i);
  if (explicitAiMatch && explicitAiMatch[1]) {
    const directQuery = explicitAiMatch[1].trim();
    const staticItem = await findStatic(directQuery);
    if (staticItem) return staticItem;

    const aiCmd = await resolveCommandWithAI(directQuery);
    if (aiCmd) return aiCmd;
  }

  // Búsqueda en comandos conocidos, proyectos y apps instaladas
  const staticItem = await findStatic(text);
  if (staticItem) return staticItem;

  // Si no se encontró y empezaba con verbo de ejecución ("ejecuta ...", "corre ...")
  if (/^(?:ejecuta|corre|exec|run)\s+/i.test(text)) {
    const aiCmd = await resolveCommandWithAI(text);
    if (aiCmd) return aiCmd;

    const query = text.replace(/^(?:ejecuta|corre|exec|run)\s+/i, '').trim();
    return {
      id: 'cmd-raw',
      name: query,
      command: query,
      inTerminal: true,
      kind: 'terminal',
    };
  }

  return null;
}

async function launch(item) {
  if (!item) return { ok: false, error: 'No se especificó comando o aplicación' };

  try {
    let child;
    if (item.inTerminal) {
      // Lanzar en kitty con bash para mantener visible la salida
      child = spawn('kitty', ['-e', 'bash', '-c', `${item.command}; echo ''; echo 'Presiona Enter para cerrar...'; read -r`], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
    } else if (Array.isArray(item.args) && item.args.length) {
      child = spawn(item.command, item.args, {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
    } else {
      child = spawn('bash', ['-c', item.command], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
    }

    child.unref();
    return { ok: true, name: item.name };
  } catch (err) {
    console.error(`[capri:launcher] Falló al lanzar ${item.name}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function openUrl(rawUrl, browser = null) {
  let targetUrl = String(rawUrl || '').trim();
  if (!targetUrl) return false;
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  const b = String(browser || '').toLowerCase();
  try {
    if (b.includes('chrome')) {
      const child = spawn('/usr/bin/flatpak', ['run', '--command=/app/bin/chrome', 'com.google.Chrome', targetUrl], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      return true;
    }

    if (b.includes('brave')) {
      const child = spawn('brave', [targetUrl], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      return true;
    }

    const { shell } = require('electron');
    if (shell && typeof shell.openExternal === 'function') {
      await shell.openExternal(targetUrl);
      return true;
    }

    const child = spawn('xdg-open', [targetUrl], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return true;
  } catch (err) {
    console.error(`[capri:launcher] Error al abrir URL (${targetUrl}):`, err.message);
    return false;
  }
}

module.exports = {
  find,
  launch,
  openUrl,
  scanApps,
  scanDevProjects,
  DEV_DIR,
};

