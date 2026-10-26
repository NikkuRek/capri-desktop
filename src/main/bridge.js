'use strict';

// Bridge HTTP local para Antigravity IDE (127.0.0.1:47823).
// Recibe eventos de herramientas, tareas y estado de Antigravity IDE y los transmite a Capri.

const http = require('node:http');

const MAX_BODY = 512 * 1024;
const DEFAULT_PORT = 47823;

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function createBridge({ port = DEFAULT_PORT, onEvent } = {}) {
  const server = http.createServer(async (req, res) => {
    // Rechazar peticiones externas con Origin de navegadores web
    if (req.headers.origin) return send(res, 403, { ok: false });

    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, name: 'capri', ide: 'antigravity', pid: process.pid });
    }

    if (req.method === 'POST' && url.pathname === '/event') {
      try {
        const evt = await readJson(req);
        if (!evt || typeof evt !== 'object') {
          return send(res, 400, { ok: false, error: 'payload must be a json object' });
        }
        if (typeof onEvent === 'function') {
          onEvent(evt);
        }
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 400, { ok: false, error: err.message });
      }
    }

    send(res, 404, { ok: false });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[capri:bridge] El puerto ${port} ya está en uso.`);
    } else {
      console.error('[capri:bridge] Error en servidor bridge:', err.message);
    }
  });

  const p = Number(process.env.CAPRI_BRIDGE_PORT) || port;
  server.listen(p, '127.0.0.1', () => {
    console.log(`[capri:bridge] Servidor activo en 127.0.0.1:${p} para Antigravity IDE`);
  });

  return server;
}

module.exports = { createBridge, DEFAULT_PORT };
