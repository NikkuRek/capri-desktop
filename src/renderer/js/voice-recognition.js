// Reconocimiento de voz y comandos hablados para Capri.
// Utiliza Web Speech API en primer lugar (si está disponible y online)
// y captura por micrófono con codificación WAV + IA multimodal (Gemini) como fallback robusto.

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
  view.setUint16(22, 1, true); // 1 channel (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // 16 bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export class VoiceRecognition {
  constructor(host) {
    this.host = host;
    this.active = false;
    this.recognition = null;
    this.audioStream = null;
    this.audioContext = null;
    this.processor = null;
    this.recordedSamples = [];
    this.silenceTimer = null;
    this.maxTimer = null;
    this.hasDetectedSpeech = false;
    this.mode = null;
    this.callbacks = null;
  }

  isSupported() {
    return Boolean(
      (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
      (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia)
    );
  }

  async start({ onInterim, onResult, onError, onStateChange, lang = 'es-ES' } = {}) {
    if (this.active) {
      this.stop();
      return;
    }

    this.active = true;
    this.callbacks = { onInterim, onResult, onError, onStateChange };
    this.recordedSamples = [];
    this.hasDetectedSpeech = false;
    onStateChange?.(true);

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Intentar Web Speech API primero
    if (SpeechRec) {
      try {
        let gotResult = false;
        let fallbackTriggered = false;

        const rec = new SpeechRec();
        rec.lang = lang;
        rec.continuous = false;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        rec.onresult = (event) => {
          gotResult = true;
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const item = event.results[i];
            const text = item[0]?.transcript || '';
            if (item.isFinal) final += text;
            else interim += text;
          }
          if (interim) onInterim?.(interim);
          if (final) onResult?.(final.trim());
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
          if (!fallbackTriggered) {
            onError?.(err.error || 'error');
            this.cleanup();
          }
        };

        rec.onend = () => {
          if (!fallbackTriggered) {
            this.cleanup();
          }
        };

        this.recognition = rec;
        this.mode = 'speech-api';
        rec.start();
        return;
      } catch (err) {
        console.warn('[capri:voice] fallo WebSpeech, usando fallback:', err);
      }
    }

    await this.startAudioFallback();
  }

  async startAudioFallback() {
    const { onInterim, onError } = this.callbacks || {};

    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.('no_mic_support');
      this.cleanup();
      return;
    }

    try {
      this.mode = 'audio-record';
      onInterim?.('🎙️ Escuchando...');

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

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: 16000 });
      this.audioContext = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      // Buffer size 4096 a 16kHz da eventos cada ~256ms
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      this.processor = processor;

      let silenceTicks = 0;

      processor.onaudioprocess = (e) => {
        if (!this.active || this.mode !== 'audio-record') return;
        const channelData = e.inputBuffer.getChannelData(0);
        // Clonar datos de audio
        this.recordedSamples.push(new Float32Array(channelData));

        // Calcular volumen RMS
        let sum = 0;
        for (let i = 0; i < channelData.length; i++) {
          sum += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sum / channelData.length);

        if (rms > 0.02) {
          this.hasDetectedSpeech = true;
          silenceTicks = 0;
        } else if (this.hasDetectedSpeech) {
          silenceTicks++;
          // ~1.5 segundos de silencio tras hablar (6 ticks a ~256ms)
          if (silenceTicks >= 6) {
            this.stop();
          }
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Tiempo límite máximo de 12 segundos
      this.maxTimer = setTimeout(() => {
        if (this.active) this.stop();
      }, 12000);
    } catch (err) {
      console.error('[capri:voice] Error accediendo al micrófono:', err);
      onError?.(err.name || 'permission_denied');
      this.cleanup();
    }
  }

  async stop() {
    if (!this.active) return;

    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
      return;
    }

    if (this.mode === 'audio-record') {
      const { onInterim, onResult, onError } = this.callbacks || {};
      onInterim?.('⏳ Transcribiendo...');

      // Desconectar procesador
      if (this.processor) {
        this.processor.disconnect();
        this.processor = null;
      }

      // Fusionar muestras registradas
      let totalLength = 0;
      for (const chunk of this.recordedSamples) {
        totalLength += chunk.length;
      }

      if (totalLength < 4000) { // menos de 0.25s
        this.cleanup();
        return;
      }

      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.recordedSamples) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const sampleRate = this.audioContext?.sampleRate || 16000;
      const wavBlob = encodeWav(merged, sampleRate);

      try {
        const reader = new FileReader();
        reader.readAsDataURL(wavBlob);
        reader.onloadend = async () => {
          const dataUrl = reader.result;
          const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : null;

          if (!base64) {
            this.cleanup();
            return;
          }

          const res = await this.host.transcribeAudio({ base64, mimeType: 'audio/wav' });
          if (res?.ok && res.text && res.text.trim()) {
            onResult?.(res.text.trim());
          } else if (!res?.ok && res?.error) {
            console.warn('[capri:voice] Transcripción error:', res.error);
            onError?.(res.error);
          }
          this.cleanup();
        };
      } catch (err) {
        console.error('[capri:voice] Fallo procesando WAV:', err);
        onError?.(err.message);
        this.cleanup();
      }
    }
  }

  cancel() {
    this.recordedSamples = [];
    if (this.recognition) {
      try { this.recognition.abort(); } catch {}
    }
    this.cleanup();
  }

  cleanup() {
    this.active = false;
    this.recognition = null;
    this.mode = null;
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    this.callbacks?.onStateChange?.(false);
  }
}
