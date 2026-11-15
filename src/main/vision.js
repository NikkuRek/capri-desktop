'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app } = require('electron');
const NodeWebcam = require('node-webcam');

const execFileAsync = promisify(execFile);

const WEBCAM_OPTS = {
  width: 640,
  height: 480,
  quality: 80,
  delay: 0,
  saveShots: true,
  output: 'jpeg',
  device: false,
  callbackReturn: 'location',
  verbose: false,
  silent: true,
};

function captureWithNodeWebcam(tempPath) {
  return new Promise((resolve, reject) => {
    const webcam = NodeWebcam.create(WEBCAM_OPTS);
    webcam.capture(tempPath, (err, data) => {
      if (err) return reject(err);
      resolve(data || tempPath);
    });
  });
}

async function captureWithFfmpeg(tempPath) {
  const device = fs.existsSync('/dev/video0') ? '/dev/video0' : null;
  if (!device) {
    throw new Error('No se detectó ningún dispositivo de cámara (/dev/video0).');
  }
  await execFileAsync(
    'ffmpeg',
    ['-f', 'video4linux2', '-i', device, '-frames:v', '1', '-q:v', '4', '-y', tempPath],
    { timeout: 6000 }
  );
  return tempPath;
}

/**
 * Captura un único fotograma de la webcam en formato JPEG Base64 sin mostrar interfaz gráfica.
 * @returns {Promise<{ok: boolean, mimeType?: string, base64?: string, error?: string}>}
 */
async function captureFrame() {
  const tempDir = app.getPath('temp');
  const tempPath = path.join(tempDir, `capri_vision_${Date.now()}.jpg`);

  try {
    let capturedPath = tempPath;

    try {
      capturedPath = await captureWithNodeWebcam(tempPath);
    } catch (webcamErr) {
      // En Linux, node-webcam depende de fswebcam; si falta, intentamos con ffmpeg
      if (process.platform === 'linux') {
        try {
          capturedPath = await captureWithFfmpeg(tempPath);
        } catch (ffmpegErr) {
          throw new Error(ffmpegErr.message || webcamErr.message);
        }
      } else {
        throw webcamErr;
      }
    }

    const buffer = await fs.promises.readFile(capturedPath);
    if (!buffer || buffer.length === 0) {
      return { ok: false, error: 'La cámara devolvió una imagen vacía.' };
    }

    return {
      ok: true,
      mimeType: 'image/jpeg',
      base64: buffer.toString('base64'),
    };
  } catch (err) {
    const detail = err?.message || String(err);
    console.warn('[capri:vision] Error al capturar fotograma:', detail);
    return {
      ok: false,
      error: `No se pudo acceder a la webcam (verifica que esté conectada y con permisos): ${detail}`,
    };
  } finally {
    await fs.promises.unlink(tempPath).catch(() => {});
  }
}

module.exports = {
  captureFrame,
};
