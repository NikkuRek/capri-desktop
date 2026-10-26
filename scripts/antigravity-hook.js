#!/usr/bin/env node
'use strict';

// Emisor de eventos desde Antigravity IDE hacia Capri Desktop.
// Uso:
//   node scripts/antigravity-hook.js --event tool --name run_command --target "npm test"
//   node scripts/antigravity-hook.js --event done --project mi-proyecto
//   node scripts/antigravity-hook.js --event error --tool view_file --message "Archivo no encontrado"
//   node scripts/antigravity-hook.js --event status --msg "Analizando dependencias..."

const http = require('node:http');

const args = process.argv.slice(2);
const params = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      params[key] = next;
      i++;
    } else {
      params[key] = true;
    }
  }
}

const eventType = params.event || params.type || 'status';
const payload = {
  hook_event_name: eventType,
  tool_name: params.name || params.tool || null,
  target: params.target || null,
  project: params.project || 'capri-desktop',
  message: params.message || params.msg || '',
  status: params.status || 'running',
  timestamp: Date.now(),
};

const json = JSON.stringify(payload);
const port = Number(process.env.CAPRI_BRIDGE_PORT) || 47823;

const req = http.request({
  hostname: '127.0.0.1',
  port,
  path: '/event',
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json),
  },
  timeout: 1500,
}, (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

req.on('error', () => {
  // Capri no está corriendo o bridge apagado; salir silenciosamente para no interrumpir Antigravity
  process.exit(0);
});

req.write(json);
req.end();
