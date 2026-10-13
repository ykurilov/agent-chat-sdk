import { describe, expect, it } from "vitest";
import { pcmRms } from "../src/server/pcm-level";

const pcm = (samples: number[]) => new Uint8Array(new Int16Array(samples).buffer);

describe("громкость куска звука (RMS, 0…1)", () => {
  it("тишина и пустой кусок — 0", () => {
    expect(pcmRms(pcm([0, 0, 0, 0]))).toBe(0);
    expect(pcmRms(new Uint8Array(0))).toBe(0);
  });

  it("постоянный сигнал: RMS равна его доле от полной шкалы", () => {
    expect(pcmRms(pcm(new Array(100).fill(16384)))).toBeCloseTo(0.5, 4);
    expect(pcmRms(pcm(new Array(100).fill(-16384)))).toBeCloseTo(0.5, 4);
  });

  it("меандр на полной шкале — 1; половина тишины — 1/√2", () => {
    expect(pcmRms(pcm([-32768, -32768, -32768]))).toBeCloseTo(1, 4);
    expect(pcmRms(pcm([32768 - 1, 0, 32768 - 1, 0]))).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it("нечётный последний байт (половина отсчёта) не считается", () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 255]);
    expect(pcmRms(bytes)).toBe(0);
  });

  it("работает на куске с ненулевым смещением в общем буфере", () => {
    const whole = pcm([0, 0, 16384, 16384]);
    expect(pcmRms(whole.subarray(4))).toBeCloseTo(0.5, 4);
  });
});
