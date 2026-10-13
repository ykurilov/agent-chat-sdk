import { describe, expect, it } from "vitest";
import { createSoundDedupe } from "../src/server/sound-dedupe";

describe("повторы одного звука в соседних кусках (по виду и времени)", () => {
  it("первый звук новый; тот же вид на том же месте — повтор", () => {
    const dedupe = createSoundDedupe({ gapMs: 500 });
    expect(dedupe.isNew("laughter", 1000, 1400)).toBe(true);
    expect(dedupe.isNew("laughter", 1000, 1400)).toBe(false);
  });

  it("перекрытие: тот же звук, найденный в двух кусках с чуть разными границами, — один", () => {
    const dedupe = createSoundDedupe({ gapMs: 500 });
    expect(dedupe.isNew("laughter", 1200, 2000)).toBe(true);
    expect(dedupe.isNew("laughter", 1100, 1900)).toBe(false);
  });

  it("стык: звук продолжается за границей куска (разрыв не больше gapMs) — один", () => {
    const dedupe = createSoundDedupe({ gapMs: 500 });
    expect(dedupe.isNew("laughter", 2000, 3000)).toBe(true);
    expect(dedupe.isNew("laughter", 3000, 3800)).toBe(false);
    expect(dedupe.isNew("laughter", 3500, 3900)).toBe(false);
  });

  it("разрыв больше gapMs — отдельный звук", () => {
    const dedupe = createSoundDedupe({ gapMs: 500 });
    expect(dedupe.isNew("laughter", 2000, 3000)).toBe(true);
    expect(dedupe.isNew("laughter", 3501, 4000)).toBe(true);
  });

  it("другой вид на том же месте — отдельный звук", () => {
    const dedupe = createSoundDedupe({ gapMs: 500 });
    expect(dedupe.isNew("laughter", 2000, 3000)).toBe(true);
    expect(dedupe.isNew("sigh", 2000, 3000)).toBe(true);
  });

  it("порядок ответов не важен: сначала более поздний кусок, потом ранний — всё равно один", () => {
    const dedupe = createSoundDedupe({ gapMs: 500 });
    expect(dedupe.isNew("laughter", 3000, 3800)).toBe(true);
    expect(dedupe.isNew("laughter", 2000, 3000)).toBe(false);
  });

  it("цепочка: смех через три куска подряд — один", () => {
    const dedupe = createSoundDedupe({ gapMs: 500 });
    expect(dedupe.isNew("laughter", 1000, 2000)).toBe(true);
    expect(dedupe.isNew("laughter", 2000, 3000)).toBe(false);
    expect(dedupe.isNew("laughter", 3000, 4000)).toBe(false);
  });

  it("старые записи забываются: память не растёт без конца", () => {
    const dedupe = createSoundDedupe({ gapMs: 500, remember: 3 });
    for (let index = 0; index < 5; index++) dedupe.isNew("laughter", index * 10_000, index * 10_000 + 500);
    // самый первый смех уже забыт: такой же «новый» снова
    expect(dedupe.isNew("laughter", 0, 500)).toBe(true);
  });
});
