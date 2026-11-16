// AudioWorkletProcessor para captura de audio crudo en hilo dedicado sin estrangulamiento.
// Acumula bloques de ~4096 muestras (~256ms a 16kHz) antes de transferirlos al hilo principal.

class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 4096;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];
    let i = 0;
    while (i < channel.length) {
      const remaining = this.chunkSize - this.offset;
      const toCopy = Math.min(remaining, channel.length - i);
      this.buffer.set(channel.subarray(i, i + toCopy), this.offset);
      this.offset += toCopy;
      i += toCopy;

      if (this.offset >= this.chunkSize) {
        const out = this.buffer;
        this.port.postMessage(out, [out.buffer]);
        this.buffer = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('vad-processor', VadProcessor);
