// Reconocimiento de voz y comandos hablados para Capri.
// Soporta modo de escucha continua (Hotword / Wake Word "Capri") como Jarvis o Google Assistant,
// además de comandos por pulsación directa y transcripción multimodal rápida con Gemini.

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // 1 = PCM uncompressed
  view.setUint16(22, 1, true); // 1 canal (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // 16 bits por muestra
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : null;
      resolve(base64);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

// Regex para detectar "Capri" al inicio o en la frase
const WAKE_WORD_RE = /^(?:(?:oye|hey|ok|hola|eh|ey)\s+)?(?:capri|capry|cabri|kapri|capre|catri|capi|cafri)\b[,:\s-]*(.*)/i;
const EMBEDDED_CAPRI_RE = /\b(?:capri|capry|cabri|kapri|capre|catri|capi|cafri)\b[,:\s-]*(.*)/i;

export class VoiceRecognition {
  constructor(host) {
    this.host = host;
    this.active = false;
    this.alwaysOn = false;
    this.isPaused = false;
    this.waitingForFollowup = false;
    this.followupTimer = null;

    this.recognition = null;
    this.audioStream = null;
    this.audioContext = null;
    this.processor = null;

    this.recordedSamples = [];
    this.isSpeaking = false;
    this.silenceTicks = 0;
    this.isTranscribing = false;

    this.callbacks = null;
    this.mode = null; // 'speech-api' | 'audio-record'
  }

  isSupported() {
    return Boolean(
      (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
      (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia)
    );
  }

  // Inicia el modo de escucha continua tipo Jarvis (Wake Word "Capri")
  async startContinuous({ onWakeWord, onSpeechStateChange, onTranscribing, onFollowupTimeout, onInterim, onError, lang = 'es-ES' } = {}) {
    this.alwaysOn = true;
    this.isPaused = false;
    this.callbacks = {
      ...this.callbacks,
      onWakeWord,
      onSpeechStateChange,
      onTranscribing,
      onFollowupTimeout,
      onInterim,
      onError,
      lang,
    };

    if (this.active) return;
    await this.initStream();
  }

  pauseContinuous() {
    this.isPaused = true;
    this.waitingForFollowup = false;
    this.clearFollowupTimer();
    this.callbacks?.onSpeechStateChange?.(false);
  }

  resumeContinuous() {
    this.isPaused = false;
    if (!this.active) {
      this.initStream();
    }
  }

  toggleContinuous() {
    if (!this.alwaysOn) {
      this.startContinuous(this.callbacks || {});
      return true;
    }
    if (this.isPaused) {
      this.resumeContinuous();
      return true;
    }
    this.pauseContinuous();
    return false;
  }

  // Pone a Capri a escuchar directamente la orden sin necesidad de decir "Capri" primero
  triggerDirectListen(timeoutMs = 8000) {
    this.waitingForFollowup = true;
    this.clearFollowupTimer();
    this.followupTimer = setTimeout(() => {
      this.waitingForFollowup = false;
      this.callbacks?.onFollowupTimeout?.();
    }, timeoutMs);
  }

  clearFollowupTimer() {
    if (this.followupTimer) {
      clearTimeout(this.followupTimer);
      this.followupTimer = null;
    }
  }

  // Inicializa el flujo de micrófono (WebSpeech API en navegador o getUserMedia + VAD en Electron)
  async initStream() {
    if (this.active) return;
    const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
    const SpeechRec = !isElectron && (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (SpeechRec) {
      try {
        let gotResult = false;
        let fallbackTriggered = false;

        const rec = new SpeechRec();
        rec.lang = this.callbacks?.lang || 'es-ES';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        rec.onresult = (event) => {
          if (this.isPaused) return;
          gotResult = true;
          let interim = '';
          let final = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const item = event.results[i];
            const text = item[0]?.transcript || '';
            if (item.isFinal) final += text;
            else interim += text;
          }

          if (interim) {
            this.callbacks?.onInterim?.(interim);
            this.callbacks?.onSpeechStateChange?.(true);
          }

          if (final) {
            this.callbacks?.onSpeechStateChange?.(false);
            this.handleTranscription(final.trim());
          }
        };

        rec.onerror = async (err) => {
          console.warn('[capri:voice] WebSpeech error:', err.error);
          if (!gotResult && !fallbackTriggered && (err.error === 'network' || err.error === 'not-allowed' || err.error === 'service-not-allowed' || err.error === 'audio-capture')) {
            fallbackTriggered = true;
            try { rec.abort(); } catch {}
            this.recognition = null;
            await this.startAudioFallback();
            return;
          }
        };

        rec.onend = () => {
          if (this.alwaysOn && !this.isPaused && !fallbackTriggered) {
            try { rec.start(); } catch {}
          } else if (!fallbackTriggered) {
            this.active = false;
          }
        };

        this.recognition = rec;
        this.mode = 'speech-api';
        this.active = true;
        rec.start();
        return;
      } catch (err) {
        console.warn('[capri:voice] Fallo inicializando WebSpeech, usando fallback VAD:', err);
      }
    }

    await this.startAudioFallback();
  }

  async startAudioFallback() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callbacks?.onError?.('no_mic_support');
      this.cleanup();
      return;
    }

    try {
      this.mode = 'audio-record';
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      this.audioStream = stream;
      this.recordedSamples = [];
      this.isSpeaking = false;
      this.silenceTicks = 0;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: 16000 });
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
      this.audioContext = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      // Buffer size 4096 a 16kHz da eventos cada ~256ms
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      this.processor = processor;

      // Silenciar salida al altavoz manteniendo vivo el grafo de audio
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      let preRoll = [];
      const PRE_ROLL_CHUNKS = 2; // ~512ms previos para no cortar el inicio de "Capri"
      let noiseFloor = 0.001;

      processor.onaudioprocess = (e) => {
        if (!this.active || this.isPaused || this.mode !== 'audio-record') return;
        const channelData = e.inputBuffer.getChannelData(0);

        // Calcular volumen RMS
        let sum = 0;
        for (let i = 0; i < channelData.length; i++) {
          sum += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sum / channelData.length);
        const threshold = Math.max(0.0025, noiseFloor * 2.6);

        if (rms > threshold) {
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            this.recordedSamples = [...preRoll];
            preRoll = [];
            this.callbacks?.onSpeechStateChange?.(true);
          }
          this.silenceTicks = 0;
          this.recordedSamples.push(new Float32Array(channelData));
        } else if (this.isSpeaking) {
          this.silenceTicks++;
          this.recordedSamples.push(new Float32Array(channelData));

          // ~760ms de silencio tras hablar (3 ticks a ~256ms)
          if (this.silenceTicks >= 3) {
            this.isSpeaking = false;
            this.silenceTicks = 0;
            this.callbacks?.onSpeechStateChange?.(false);

            const chunks = this.recordedSamples;
            this.recordedSamples = [];

            // Procesar si supera ~0.38s de audio mínimo (6000 muestras) y tiene pico suficiente
            let totalLen = 0;
            let maxPeak = 0;
            for (const c of chunks) {
              totalLen += c.length;
              for (let i = 0; i < c.length; i += 4) {
                const v = Math.abs(c[i]);
                if (v > maxPeak) maxPeak = v;
              }
            }
            if (totalLen >= 6000 && maxPeak >= 0.005) {
              this.processRecordedSpeech(chunks, totalLen, maxPeak);
            }
          }
        } else {
          // Actualizar piso de ruido ambiental suavemente
          noiseFloor = noiseFloor * 0.92 + rms * 0.08;
          preRoll.push(new Float32Array(channelData));
          if (preRoll.length > PRE_ROLL_CHUNKS) preRoll.shift();
        }
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      this.active = true;
      console.warn('[capri:voice] Micrófono siempre activo (VAD adaptativo listo).');
    } catch (err) {
      console.error('[capri:voice] Error accediendo al micrófono:', err);
      this.callbacks?.onError?.(err.name || 'permission_denied');
      this.cleanup();
    }
  }

  async processRecordedSpeech(chunks, totalLength, maxPeak = 0.1) {
    if (this.isTranscribing) return;
    this.isTranscribing = true;
    this.callbacks?.onTranscribing?.(true);

    try {
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      // Normalizar ganancia para micrófonos con volumen bajo (ej. 27% en Linux)
      if (maxPeak > 0.001 && maxPeak < 0.5) {
        const gain = Math.min(12, 0.75 / maxPeak);
        for (let i = 0; i < merged.length; i++) {
          merged[i] = Math.max(-1, Math.min(1, merged[i] * gain));
        }
      }

      const sampleRate = this.audioContext?.sampleRate || 16000;
      const wavBlob = encodeWav(merged, sampleRate);
      const base64 = await blobToBase64(wavBlob);

      if (!base64) return;

      const res = await this.host.transcribeAudio({ base64, mimeType: 'audio/wav' });
      if (res?.ok && res.text && res.text.trim()) {
        console.warn('[capri:voice] Transcripción:', res.text.trim());
        this.handleTranscription(res.text.trim());
      } else if (res && !res.ok) {
        console.warn('[capri:voice] Fallo transcripción:', res.error);
      }
    } catch (err) {
      console.warn('[capri:voice] Error procesando transcripción:', err.message);
    } finally {
      this.isTranscribing = false;
      this.callbacks?.onTranscribing?.(false);
    }
  }

  // Maneja el texto transcrito y aplica la lógica de activación por palabra clave "Capri"
  handleTranscription(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return;

    console.log('[capri:voice] Escuchado:', text);

    // Caso 1: Estábamos esperando la instrucción directa (se dijo "Capri" antes o se pulsó el mic)
    if (this.waitingForFollowup) {
      this.clearFollowupTimer();
      this.waitingForFollowup = false;
      this.callbacks?.onWakeWord?.({
        fullText: text,
        command: text,
        isPrompt: false,
      });
      return;
    }

    // Caso 2: Comprobar si la frase incluye la palabra clave "Capri"
    const match = WAKE_WORD_RE.exec(text) || EMBEDDED_CAPRI_RE.exec(text);
    if (match) {
      const instruction = (match[1] || '')
        .replace(/^[,\s:;-]+/, '')
        .replace(/[.!?¿¡]+$/g, '')
        .trim();

      if (instruction.length >= 2) {
        // Ejemplo: "Capri ejecuta docker ps" o "Capri abre brave"
        this.clearFollowupTimer();
        this.callbacks?.onWakeWord?.({
          fullText: text,
          command: instruction,
          isPrompt: false,
        });
      } else {
        // Solo dijo "Capri" -> despierta y espera la orden
        this.waitingForFollowup = true;
        this.clearFollowupTimer();
        this.followupTimer = setTimeout(() => {
          this.waitingForFollowup = false;
          this.callbacks?.onFollowupTimeout?.();
        }, 8000);

        this.callbacks?.onWakeWord?.({
          fullText: text,
          command: '',
          isPrompt: true,
        });
      }
      return;
    }

    // Caso 3: Charla ajena o ruido que no menciona "Capri": se ignora completamente
  }

  // Método legado / directo para pulsación única de botón
  async start({ onInterim, onResult, onError, onStateChange, lang = 'es-ES' } = {}) {
    if (this.alwaysOn && !this.isPaused) {
      // Si la escucha continua ya está corriendo, entrar directamente a escuchar la orden
      this.triggerDirectListen();
      onStateChange?.(true);
      return;
    }

    this.callbacks = { ...this.callbacks, onInterim, onResult, onError, onStateChange, lang };
    await this.startContinuous({
      onWakeWord: ({ command }) => {
        if (command) onResult?.(command);
      },
      onSpeechStateChange: onStateChange,
      onInterim,
      onError,
      lang,
    });
  }

  stop() {
    this.waitingForFollowup = false;
    this.clearFollowupTimer();
    this.callbacks?.onSpeechStateChange?.(false);
  }

  cancel() {
    this.stop();
  }

  cleanup() {
    this.active = false;
    this.waitingForFollowup = false;
    this.clearFollowupTimer();

    if (this.recognition) {
      try { this.recognition.abort(); } catch {}
      this.recognition = null;
    }

    if (this.processor) {
      try { this.processor.disconnect(); } catch {}
      this.processor = null;
    }

    if (this.audioStream) {
      try {
        this.audioStream.getTracks().forEach((track) => track.stop());
      } catch {}
      this.audioStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }

    this.callbacks?.onSpeechStateChange?.(false);
  }
}
