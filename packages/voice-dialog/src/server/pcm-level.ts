/** Громкость куска звука PCM s16le: среднеквадратичное значение (RMS) от 0 (тишина) до 1 (полная шкала). */
export function pcmRms(pcm: Uint8Array): number {
  const count = Math.floor(pcm.byteLength / 2);
  if (count === 0) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, count * 2);
  let sum = 0;
  for (let index = 0; index < count; index++) {
    const sample = view.getInt16(index * 2, true) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / count);
}
