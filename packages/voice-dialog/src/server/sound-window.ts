import { MIC_SAMPLE_RATE } from "../protocol";
import { pcmRms } from "./pcm-level";

const BYTES_PER_SECOND = MIC_SAMPLE_RATE * 2;
/** Хвост короче этого нового звука в Scribe не отправляется: звук уйдёт со следующим куском. */
const MIN_TAIL_SECONDS = 0.3;

export interface SoundWindowOptions {
  /** Каждые столько секунд нового звука готов очередной кусок для Scribe. `0` — кусков нет, звук уходит только на конце фразы. */
  chunkSeconds: number;
  /** Сколько секунд прежнего звука повторяется в начале следующего куска: смех на стыке не разрезается. */
  overlapSeconds: number;
  /** Кусок тише этого (RMS от 0 до 1) считается тишиной и не отправляется. `0` — не проверять. */
  silenceRms: number;
  /** Не больше стольких секунд звука за раз: старое отбрасывается. */
  maxWindowSeconds: number;
}

/** Звук для одного запроса к Scribe. */
export interface SoundSlice {
  pcm: Uint8Array;
  /** Где кусок начинается в потоке микрофона, мс от начала потока. */
  startMs: number;
  durationMs: number;
}

export interface SoundWindow {
  /** Звук микрофона (PCM s16le, моно, 16 кГц) любой длины. */
  push(frame: Uint8Array): void;
  /** Накопилось `chunkSeconds` нового звука. */
  chunkDue(): boolean;
  /**
   * Взять звук для запроса: `chunk` — очередной кусок, `tail` — остаток на конце фразы (после него следующая фраза начинается без перекрытия).
   * `null` — отправлять нечего (тишина, слишком мало). Тишина считается пройденной; слишком короткий хвост остаётся.
   * Не вызывать, если запрос сейчас делать нельзя: звук тогда накапливается и уйдёт со следующим куском.
   */
  take(kind: "chunk" | "tail"): SoundSlice | null;
  /** Сколько байт звука хранится (для проверки, что память не растёт). */
  bufferedBytes(): number;
}

export function createSoundWindow(options: SoundWindowOptions): SoundWindow {
  const chunkBytes = Math.round(options.chunkSeconds * BYTES_PER_SECOND);
  const overlapBytes = Math.round(options.overlapSeconds * BYTES_PER_SECOND);
  const maxBytes = Math.round(options.maxWindowSeconds * BYTES_PER_SECOND);
  const minTailBytes = options.chunkSeconds > 0 ? Math.round(MIN_TAIL_SECONDS * BYTES_PER_SECOND) : 1;

  let frames: Uint8Array[] = [];
  /** Все смещения — в байтах от начала потока. */
  let bufferStart = 0;
  let received = 0;
  /** До сюда звук уже отправлен (или признан тишиной). */
  let sentUntil = 0;
  /** Перекрытие не заходит за эту отметку: она ставится на конце фразы. */
  let noOverlapBefore = 0;

  /** Отсчёт — 2 байта, куски приходят любой длины: границы считаем от начала потока. */
  const alignUp = (offset: number) => offset + (offset % 2);
  const sliceStart = () => alignUp(Math.max(sentUntil - overlapBytes, noOverlapBefore, received - maxBytes, bufferStart, 0));

  function dropBefore(offset: number) {
    let count = offset - bufferStart;
    while (count > 0 && frames.length > 0) {
      const first = frames[0]!;
      const dropped = Math.min(count, first.byteLength);
      if (dropped === first.byteLength) frames.shift();
      else frames[0] = first.subarray(dropped);
      bufferStart += dropped;
      count -= dropped;
    }
  }

  function read(from: number, to: number): Uint8Array {
    const pcm = new Uint8Array(to - from);
    let position = bufferStart;
    for (const frame of frames) {
      const end = position + frame.byteLength;
      if (end > from && position < to) {
        const begin = Math.max(from, position);
        pcm.set(frame.subarray(begin - position, Math.min(to, end) - position), begin - from);
      }
      position = end;
    }
    return pcm;
  }

  return {
    push(frame) {
      frames.push(frame.slice());
      received += frame.byteLength;
      dropBefore(sliceStart());
    },

    chunkDue: () => chunkBytes > 0 && received - sentUntil >= chunkBytes,

    take(kind) {
      const start = sliceStart();
      const end = received - (received % 2);
      const newFrom = Math.max(sentUntil, start);
      if (end - newFrom < (kind === "tail" ? minTailBytes : 2)) return null;
      const commit = () => {
        sentUntil = end;
        if (kind === "tail") noOverlapBefore = end;
        dropBefore(sliceStart());
      };
      if (options.silenceRms > 0 && pcmRms(read(newFrom, end)) < options.silenceRms) {
        commit();
        return null;
      }
      const slice = { pcm: read(start, end), startMs: Math.round((start / BYTES_PER_SECOND) * 1000), durationMs: Math.round(((end - start) / BYTES_PER_SECOND) * 1000) };
      commit();
      return slice;
    },

    bufferedBytes: () => received - bufferStart,
  };
}
