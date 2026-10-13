import { describe, expect, it } from "vitest";
import { cutAtCharBoundary, withoutLoneSurrogates } from "../../../src/text/safe-truncate";

describe("cutAtCharBoundary", () => {
  it("короткий текст возвращает как есть", () => {
    expect(cutAtCharBoundary("привет", 10)).toBe("привет");
    expect(cutAtCharBoundary("привет", 6)).toBe("привет");
  });

  it("длинный режет ровно по пределу", () => {
    expect(cutAtCharBoundary("abcdef", 3)).toBe("abc");
  });

  it("эмодзи ровно на границе не рвётся: высокий суррогат не остаётся в конце", () => {
    const text = `ab😀cd`; // 😀 занимает индексы 2 и 3
    const cut = cutAtCharBoundary(text, 3);
    expect(cut).toBe("ab");
    expect(cut.length).toBeLessThanOrEqual(3);
  });

  it("эмодзи целиком внутри предела остаётся", () => {
    expect(cutAtCharBoundary("ab😀cd", 4)).toBe("ab😀");
  });

  it("предел 0 даёт пустую строку", () => {
    expect(cutAtCharBoundary("😀", 0)).toBe("");
    expect(cutAtCharBoundary("😀", 1)).toBe("");
  });
});

describe("withoutLoneSurrogates", () => {
  it("целые эмодзи не трогает", () => {
    expect(withoutLoneSurrogates("a😀b👨‍👩‍👧")).toBe("a😀b👨‍👩‍👧");
  });

  it("убирает непарный высокий суррогат в конце и в середине", () => {
    expect(withoutLoneSurrogates("ab\ud83d")).toBe("ab");
    expect(withoutLoneSurrogates("a\ud83dc")).toBe("ac");
  });

  it("убирает непарный низкий суррогат", () => {
    expect(withoutLoneSurrogates("\ude00ab")).toBe("ab");
  });

  it("текст без суррогатов возвращает той же строкой", () => {
    expect(withoutLoneSurrogates("обычный текст")).toBe("обычный текст");
  });
});
