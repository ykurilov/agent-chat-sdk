import { VOICE_TAGS } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createBargeInFilter } from "../src/browser/barge-in-filter";
import { expectedSoundsFor } from "../src/browser/voice-tag-sounds";

const LAUGH_TAGS = ["laughs", "laughs harder", "starts laughing", "wheezing", "snorts"];
const SIGH_TAGS = ["sighs", "exhales"];

describe("ожидаемые звуки для эха: что распознавание услышит на месте тега", () => {
  it.each(LAUGH_TAGS)("смех «%s» слышится как «ха», «ха-ха», «хе»", (tag) => {
    const sounds = expectedSoundsFor(tag);
    for (const word of ["ха", "ха-ха", "хе"]) expect(sounds).toContain(word);
  });

  it.each(SIGH_TAGS)("вздох и выдох «%s» слышатся как «эх», «ох», «ах», «фух»", (tag) => {
    const sounds = expectedSoundsFor(tag);
    for (const word of ["эх", "ох", "ах", "фух"]) expect(sounds).toContain(word);
  });

  it("звуки вне списка модели (chuckles, giggles, clears throat, coughs, yawns, gasps, sobs) тоже узнаются по смыслу слова", () => {
    expect(expectedSoundsFor("chuckles")).toContain("ха-ха");
    expect(expectedSoundsFor("giggles")).toContain("хи-хи");
    expect(expectedSoundsFor("clears throat")).toContain("кхм");
    expect(expectedSoundsFor("coughs")).toContain("кхм");
    expect(expectedSoundsFor("yawns")).toContain("ааа");
    expect(expectedSoundsFor("gasps")).toContain("ах");
    expect(expectedSoundsFor("sobbing")).toContain("ох");
  });

  it("тег с подачей без звука («whispers», «excited», «warm, quiet voice») звуков не ждёт", () => {
    for (const tag of ["whispers", "excited", "sarcastic", "curious", "warm, quiet voice", "low, gravelly voice"]) {
      expect(expectedSoundsFor(tag)).toEqual([]);
    }
  });

  it("каждый тег из пометки модели, дающий звук, получил звуки; остальные — пустой список", () => {
    const sounding = new Set([...LAUGH_TAGS, ...SIGH_TAGS, "crying"]);
    for (const tag of VOICE_TAGS) {
      if (sounding.has(tag)) expect(expectedSoundsFor(tag).length, tag).toBeGreaterThan(0);
      else expect(expectedSoundsFor(tag), tag).toEqual([]);
    }
  });

  it("распознавание пишет смех по-разному («Ха-ха», «Хахаха», «Хе»): фильтр эха узнаёт все ожидаемые написания", () => {
    const filter = createBargeInFilter({ now: () => 0 });
    filter.noteSpoken(expectedSoundsFor("laughs").join(" "));
    for (const heard of ["Ха-ха", "Хахаха", "ха", "Хе-хе", "хи-хи"]) {
      filter.reset();
      expect(filter.feed({ settled: [{ text: heard, confidence: 0.95 }], interim: [] }), heard).toEqual({ interrupt: false });
    }
  });
});
