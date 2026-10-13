import { describe, expect, it } from "vitest";
import { createSoundWindow } from "../src/server/sound-window";
import type { SoundWindowOptions } from "../src/server/sound-window";

const BPS = 32_000;

/** Кусок звука: `seconds` секунд, все отсчёты равны `value` (в долях от шкалы Int16 / 32768 не пересчитываем: берём как есть). */
const frame = (seconds: number, value: number) => new Uint8Array(new Int16Array(Math.round(seconds * 16_000)).fill(value).buffer);
const samples = (pcm: Uint8Array) => new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);

function windowWith(options: Partial<SoundWindowOptions> = {}) {
  return createSoundWindow({ chunkSeconds: 1.5, overlapSeconds: 0.5, silenceRms: 0.01, maxWindowSeconds: 30, ...options });
}
const LOUD = 3000;

describe("окно звука: нарезка на куски", () => {
  it("кусок готов, когда накопилось chunkSeconds нового звука; раньше — нет", () => {
    const window = windowWith();
    window.push(frame(1.4, LOUD));
    expect(window.chunkDue()).toBe(false);
    window.push(frame(0.1, LOUD));
    expect(window.chunkDue()).toBe(true);
  });

  it("первый кусок — ровно накопленное, без перекрытия; startMs — от начала потока", () => {
    const window = windowWith();
    window.push(frame(1.5, LOUD));
    const slice = window.take("chunk")!;
    expect(slice.pcm.byteLength).toBe(1.5 * BPS);
    expect(slice.startMs).toBe(0);
    expect(slice.durationMs).toBe(1500);
    expect(window.chunkDue()).toBe(false);
  });

  it("следующий кусок начинается с перекрытия: последние overlapSeconds прежнего + новые chunkSeconds", () => {
    const window = windowWith();
    window.push(frame(0.5, 1000));
    window.push(frame(0.5, 2000));
    window.push(frame(0.5, 3000));
    window.take("chunk");
    window.push(frame(0.5, 4000));
    window.push(frame(0.5, 5000));
    window.push(frame(0.5, 6000));
    const slice = window.take("chunk")!;
    expect(slice.durationMs).toBe(2000);
    expect(slice.startMs).toBe(1000);
    const values = samples(slice.pcm);
    expect(values[0]).toBe(3000);
    expect(values[values.length - 1]).toBe(6000);
  });

  it("хвост на конце фразы: новое после последнего куска плюс перекрытие", () => {
    const window = windowWith();
    window.push(frame(1.5, LOUD));
    window.take("chunk");
    window.push(frame(1, LOUD));
    const tail = window.take("tail")!;
    expect(tail.durationMs).toBe(1500);
    expect(tail.startMs).toBe(1000);
  });

  it("после хвоста новая фраза начинается без перекрытия: звук прошлой фразы не отправляется второй раз", () => {
    const window = windowWith();
    window.push(frame(1, LOUD));
    window.take("tail");
    window.push(frame(1.5, LOUD));
    const slice = window.take("chunk")!;
    expect(slice.startMs).toBe(1000);
    expect(slice.durationMs).toBe(1500);
  });

  it("хвост без нового звука (кусок кончился ровно на конце фразы) не отправляется", () => {
    const window = windowWith();
    window.push(frame(1.5, LOUD));
    window.take("chunk");
    expect(window.take("tail")).toBeNull();
  });

  it("слишком короткий хвост (меньше 0,3 с нового) не отправляется, но звук остаётся для следующего куска", () => {
    const window = windowWith();
    window.push(frame(1.5, LOUD));
    window.take("chunk");
    window.push(frame(0.2, LOUD));
    expect(window.take("tail")).toBeNull();
    window.push(frame(1.3, LOUD));
    const next = window.take("chunk")!;
    expect(next.startMs).toBe(1000);
    expect(next.durationMs).toBe(2000);
  });

  it("chunkSeconds: 0 — кусков нет, хвост уходит целиком (как раньше: всё окно с конца прошлой фразы)", () => {
    const window = windowWith({ chunkSeconds: 0 });
    window.push(frame(5, LOUD));
    expect(window.chunkDue()).toBe(false);
    const tail = window.take("tail")!;
    expect(tail.durationMs).toBe(5000);
    expect(tail.startMs).toBe(0);
  });
});

describe("окно звука: тишина не отправляется", () => {
  it("тихий кусок не отправляется (take → null), но считается пройденным: следующий не тянет его за собой", () => {
    const window = windowWith();
    window.push(frame(1.5, 0));
    expect(window.chunkDue()).toBe(true);
    expect(window.take("chunk")).toBeNull();
    expect(window.chunkDue()).toBe(false);
    window.push(frame(1.5, LOUD));
    const slice = window.take("chunk")!;
    expect(slice.startMs).toBe(1000);
  });

  it("громкость считается по новому звуку: перекрытие с шумом тишину не оживляет", () => {
    const window = windowWith();
    window.push(frame(1.5, LOUD));
    window.take("chunk");
    window.push(frame(1.5, 0));
    expect(window.take("chunk")).toBeNull();
  });

  it("порог настраивается: сигнал RMS≈0,0153 тих при 0,02 и слышен при 0,01", () => {
    const quiet = 500;
    const strict = windowWith({ silenceRms: 0.02 });
    strict.push(frame(1.5, quiet));
    expect(strict.take("chunk")).toBeNull();
    const lenient = windowWith({ silenceRms: 0.01 });
    lenient.push(frame(1.5, quiet));
    expect(lenient.take("chunk")).not.toBeNull();
  });

  it("silenceRms: 0 — ничего не считается тишиной, даже нули", () => {
    const window = windowWith({ silenceRms: 0 });
    window.push(frame(1.5, 0));
    expect(window.take("chunk")).not.toBeNull();
  });

  it("тихий хвост не отправляется и закрывает фразу: следующая начинается без перекрытия", () => {
    const window = windowWith();
    window.push(frame(1.5, LOUD));
    window.take("chunk");
    window.push(frame(1, 0));
    expect(window.take("tail")).toBeNull();
    window.push(frame(1.5, LOUD));
    expect(window.take("chunk")!.startMs).toBe(2500);
  });
});

describe("окно звука: пропущенный кусок не теряется", () => {
  it("если кусок не взяли (Scribe занят), следующий покрывает всё непройденное плюс перекрытие", () => {
    const window = windowWith();
    window.push(frame(0.5, 1000));
    window.push(frame(0.5, 2000));
    window.push(frame(0.5, 3000));
    window.take("chunk");
    window.push(frame(1.5, 4000));
    expect(window.chunkDue()).toBe(true);
    // кусок «пропущен»: take не вызывали; звук копится дальше
    window.push(frame(1, 5000));
    const slice = window.take("chunk")!;
    expect(slice.startMs).toBe(1000);
    expect(slice.durationMs).toBe(3000);
    expect(samples(slice.pcm)[0]).toBe(3000);
  });

  it("хвост, который не взяли (лимит запросов), остаётся для следующей фразы", () => {
    const window = windowWith({ chunkSeconds: 0 });
    window.push(frame(2, LOUD));
    // фраза ушла без запроса: take("tail") не вызывали
    window.push(frame(3, LOUD));
    const tail = window.take("tail")!;
    expect(tail.durationMs).toBe(5000);
  });
});

describe("окно звука: предел и границы отсчёта", () => {
  it("не длиннее maxWindowSeconds: старое отбрасывается, startMs считается от начала потока", () => {
    const window = windowWith({ chunkSeconds: 0, maxWindowSeconds: 4 });
    window.push(frame(6, LOUD));
    const tail = window.take("tail")!;
    expect(tail.durationMs).toBe(4000);
    expect(tail.startMs).toBe(2000);
  });

  it("куски нечётной длины: начало и конец среза на границе отсчёта потока", () => {
    const window = windowWith({ chunkSeconds: 0, maxWindowSeconds: 1, silenceRms: 0 });
    let offset = 0;
    for (let index = 0; index < 3; index++) {
      const chunk = new Uint8Array(20_001).map((_, at) => ((offset + at) % 2 === 0 ? 1 : 2));
      offset += chunk.length;
      window.push(chunk);
    }
    const tail = window.take("tail")!;
    expect(tail.pcm.byteLength % 2).toBe(0);
    expect(tail.pcm.byteLength).toBeLessThanOrEqual(BPS);
    expect(tail.pcm[0]).toBe(1);
    expect(tail.pcm[1]).toBe(2);
  });

  it("память не растёт: после куска хранится только перекрытие и непройденное", () => {
    const window = windowWith();
    for (let index = 0; index < 100; index++) {
      window.push(frame(1.5, LOUD));
      window.take("chunk");
    }
    expect(window.bufferedBytes()).toBeLessThanOrEqual(0.5 * BPS);
  });
});
