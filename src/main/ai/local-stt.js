'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app } = require('electron');
const sherpaOnnx = require('sherpa-onnx-node');

const execFileAsync = promisify(execFile);

const MODEL_ARCHIVE_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2';
const MODEL_SUBDIR = 'sherpa-onnx-whisper-base';

let recognizer = null;
let downloadPromise = null;

function getModelRootDir() {
  return path.join(app.getPath('userData'), 'stt-model');
}

function findModelFiles(rootDir) {
  const candidates = [path.join(rootDir, MODEL_SUBDIR), rootDir];
  for (const dir of candidates) {
    const tokens = path.join(dir, 'base-tokens.txt');
    if (!fs.existsSync(tokens)) continue;

    // Preferir FP32 para mayor precisión en comandos cortos y anglicismos; caer a int8 si no existe
    const fp32Encoder = path.join(dir, 'base-encoder.onnx');
    const fp32Decoder = path.join(dir, 'base-decoder.onnx');
    if (fs.existsSync(fp32Encoder) && fs.existsSync(fp32Decoder)) {
      return { dir, encoder: fp32Encoder, decoder: fp32Decoder, tokens, precision: 'fp32' };
    }

    const int8Encoder = path.join(dir, 'base-encoder.int8.onnx');
    const int8Decoder = path.join(dir, 'base-decoder.int8.onnx');
    if (fs.existsSync(int8Encoder) && fs.existsSync(int8Decoder)) {
      return { dir, encoder: int8Encoder, decoder: int8Decoder, tokens, precision: 'int8' };
    }
  }
  return null;
}

async function ensureModelDownloaded() {
  const rootDir = getModelRootDir();
  const existing = findModelFiles(rootDir);
  if (existing) return existing;

  if (downloadPromise) return downloadPromise;

  downloadPromise = (async () => {
    fs.mkdirSync(rootDir, { recursive: true });
    const archivePath = path.join(rootDir, 'whisper-base.tar.bz2');
    console.log(`[capri:stt] Modelo local no encontrado en ${rootDir}. Descargando ${MODEL_SUBDIR}...`);

    try {
      const res = await fetch(MODEL_ARCHIVE_URL, { redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`Descarga fallida (${res.status} ${res.statusText})`);
      }
      const arrayBuf = await res.arrayBuffer();
      await fs.promises.writeFile(archivePath, Buffer.from(arrayBuf));

      await execFileAsync('tar', ['-xjf', archivePath, '-C', rootDir], { timeout: 120000 });
      await fs.promises.unlink(archivePath).catch(() => {});

      const files = findModelFiles(rootDir);
      if (!files) {
        throw new Error(`No se encontraron los archivos ONNX tras extraer en ${rootDir}`);
      }
      console.log(`[capri:stt] Modelo Whisper Base listo en: ${files.dir}`);
      return files;
    } finally {
      await fs.promises.unlink(archivePath).catch(() => {});
      downloadPromise = null;
    }
  })();

  return downloadPromise;
}

async function getRecognizer() {
  if (recognizer) return recognizer;

  const files = await ensureModelDownloaded();
  const threads = Math.max(1, Math.min(4, os.cpus().length));

  recognizer = new sherpaOnnx.OfflineRecognizer({
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      whisper: {
        encoder: files.encoder,
        decoder: files.decoder,
        language: 'es',
        task: 'transcribe',
      },
      tokens: files.tokens,
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
    },
  });

  console.log(`[capri:stt] Motor STT local inicializado (Whisper Base ${files.precision}, ${threads} hilos).`);
  return recognizer;
}

function cleanWhisperText(raw) {
  return String(raw || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:m[úu]sica|music|silencio|silence|risas|aplausos|sonido[^)]*)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wavBufferToFloat32(audioBuffer) {
  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
  let sampleRate = 16000;
  let pcmOffset = 0;

  if (buf.length >= 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    sampleRate = buf.readUInt32LE(24) || 16000;
    pcmOffset = 44;
  }

  const pcmBytes = buf.subarray(pcmOffset);
  const sampleCount = Math.floor(pcmBytes.length / 2);
  const samples = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    samples[i] = pcmBytes.readInt16LE(i * 2) / 32768;
  }

  return { sampleRate, samples };
}

/**
 * Transcribe audio PCM/WAV a texto de forma 100% local con Whisper Base (sherpa-onnx).
 * @param {Buffer|Uint8Array} audioBuffer
 * @returns {Promise<string>}
 */
async function transcribeLocal(audioBuffer) {
  if (!audioBuffer || audioBuffer.length === 0) {
    return '';
  }

  const rec = await getRecognizer();
  const { sampleRate, samples } = wavBufferToFloat32(audioBuffer);
  if (samples.length === 0) return '';

  const stream = rec.createStream();
  stream.acceptWaveform({ sampleRate, samples });
  rec.decode(stream);
  const result = rec.getResult(stream);
  const text = cleanWhisperText(result?.text);
  console.log('[Capri:STT] Texto reconocido:', text);
  return text;
}

module.exports = {
  transcribeLocal,
  getModelRootDir,
  ensureModelDownloaded,
};
