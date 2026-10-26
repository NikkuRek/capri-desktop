'use strict';

// Cargador de variables de entorno desde .env sin dependencias externas.
// Lee el archivo .env de la raíz del proyecto y de la carpeta userData.

const fs = require('node:fs');
const path = require('node:path');

function loadEnv(rootDir, userDataDir) {
  const candidates = [
    rootDir ? path.join(rootDir, '.env') : null,
    userDataDir ? path.join(userDataDir, '.env') : null,
  ].filter(Boolean);

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!process.env[key] || process.env[key] === '') {
              process.env[key] = val;
            }
          }
        }
      } catch (err) {
        console.error('[capri:env] Error leyendo', file, ':', err.message);
      }
    }
  }
}

module.exports = { loadEnv };
