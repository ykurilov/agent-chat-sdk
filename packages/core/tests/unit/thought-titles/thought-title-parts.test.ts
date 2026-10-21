import { describe, expect, it } from "vitest";
import { askedThoughtTitlesOfParts, thoughtTitlesOfParts, withThoughtTitles } from "../../../src/thought-titles/thought-title-parts";

describe("заголовки в частях раздумья", () => {
  it("заголовки и отметки «модель уже спрашивали» пишутся в части и читаются обратно", () => {
    const parts = [
      { type: "reasoning" as const, text: "а" },
      { type: "text" as const, text: "т" },
      { type: "reasoning" as const, text: "б" },
    ];
    const decorated = withThoughtTitles(parts, { "0": "Выбираю поле" }, new Set(["0", "1"]));
    expect(thoughtTitlesOfParts(decorated)).toEqual({ "0": "Выбираю поле" });
    expect(askedThoughtTitlesOfParts(decorated)).toBe(2);
    expect(withThoughtTitles(decorated, { "0": "Выбираю поле" }, new Set(["0", "1"]))).toBe(decorated);
  });
});
