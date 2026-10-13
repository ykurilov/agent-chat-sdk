import { describe, expect, it } from "vitest";
import { replacedByGlue, withoutGlueFragments } from "../../../src/conversation/glue-fragments";

type Part = { type: string; text?: string; data?: unknown };
const text: Part = { type: "text", text: "Так." };
const withParts = (...parts: Part[]) => ({ parts });
const plain = (id: string) => ({ id, parts: [text] });
const voice = (id: string) => ({ id, parts: [text, { type: "data-voice-mode", data: true }] });
const glue = (id: string, replaces: string, voiceId?: string) => ({
  id,
  parts: [text, { type: "data-voice-mode", data: { ...(voiceId && { voice: voiceId }), replaces } }],
});

describe("отметка склейки", () => {
  it("читается из data-voice-mode склеенного сообщения, голос рядом ей не мешает", () => {
    expect(replacedByGlue(glue("g", "u"))).toBe("u");
    expect(replacedByGlue(glue("g", "u", "pirate"))).toBe("u");
  });

  it("у обычного голосового, текстового и сообщения с чужой отметкой склейки нет", () => {
    expect(replacedByGlue(voice("u"))).toBeUndefined();
    expect(replacedByGlue(withParts(text, { type: "data-voice-mode", data: { voice: "pirate" } }))).toBeUndefined();
    expect(replacedByGlue(plain("u"))).toBeUndefined();
    expect(replacedByGlue(withParts({ type: "data-voice-mode", data: { replaces: 5 } }))).toBeUndefined();
    expect(replacedByGlue(withParts({ type: "data-voice-mode", data: { replaces: "" } }))).toBeUndefined();
    expect(replacedByGlue(withParts({ type: "data-voice-mode" }))).toBeUndefined();
  });
});

describe("сообщения без обрывков склейки", () => {
  it("убирает то, что заменила склейка, и только это; порядок остальных прежний", () => {
    const messages = [voice("u"), plain("x"), glue("g", "u")];
    expect(withoutGlueFragments(messages).map((message) => message.id)).toEqual(["x", "g"]);
  });

  it("цепочка склеек: скрыты все обрывки, остаётся последнее сообщение", () => {
    const messages = [voice("a"), glue("b", "a"), glue("c", "b")];
    expect(withoutGlueFragments(messages).map((message) => message.id)).toEqual(["c"]);
  });

  it("отметка указывает на сообщение, которого нет, — ничего не ломается", () => {
    const messages = [glue("g", "missing"), plain("x")];
    expect(withoutGlueFragments(messages).map((message) => message.id)).toEqual(["g", "x"]);
  });

  it("без склеек возвращает те же сообщения", () => {
    const messages = [plain("a"), voice("b")];
    expect(withoutGlueFragments(messages)).toEqual(messages);
  });
});
