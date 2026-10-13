/** Имя процессора захвата в `AudioWorkletGlobalScope`. */
export const CAPTURE_PROCESSOR_NAME = "voice-dialog-capture";

/**
 * Код процессора захвата: собирает звук микрофона (одна дорожка) в куски по ≈ 20 мс и отправляет их в основной поток
 * как `Float32Array` с частотой контекста. Лежит строкой и грузится через `Blob`, чтобы пакету не нужен был отдельный
 * файл для сборщика приложения. Если у приложения жёсткая политика содержимого, в ней нужен `worklet-src blob:`.
 */
export const CAPTURE_WORKLET_SOURCE = `
class VoiceDialogCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.ceil(sampleRate * 0.02);
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(this.size - this.filled, channel.length - offset);
      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.size) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR_NAME)}, VoiceDialogCapture);
`;
