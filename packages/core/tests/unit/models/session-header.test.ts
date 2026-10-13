import { describe, expect, it } from "vitest";
import { fireworksProvider } from "../../../src/models/providers/fireworks";
import { openrouterProvider } from "../../../src/models/providers/openrouter";
import { sessionHeaderValue } from "../../../src/models/providers/session-header";

const safe = /^[\x21-\x7e]{1,128}$/;

describe("sessionHeaderValue: номер чата в заголовке привязки к серверу", () => {
  it.each(["chat-42", "8f14e45f-ceea-467a-9575-7f7c2b1c0a52", "Chat_1.a:b~c"])("обычный номер %s идёт как есть", (chatId) => {
    expect(sessionHeaderValue(chatId)).toBe(chatId);
  });

  it.each([
    ["кириллица", "чат-42"],
    ["пробел и перевод строки", "chat 1\nX-Evil: 1"],
    ["эмодзи", "chat-🙂"],
    ["длиннее 128 знаков", "a".repeat(300)],
    ["пустая строка", ""],
  ])("%s: значение из безопасных ASCII-знаков не длиннее 128", (_name, chatId) => {
    expect(sessionHeaderValue(chatId)).toMatch(safe);
  });

  it("одно и то же значение для одного чата, разное для разных", () => {
    expect(sessionHeaderValue("чат-1")).toBe(sessionHeaderValue("чат-1"));
    expect(sessionHeaderValue("чат-1")).not.toBe(sessionHeaderValue("чат-2"));
    expect(sessionHeaderValue("a".repeat(300))).not.toBe(sessionHeaderValue(`${"a".repeat(299)}b`));
  });

  it.each([
    ["OpenRouter", openrouterProvider, "x-session-id"],
    ["Fireworks", fireworksProvider, "x-session-affinity"],
  ])("%s: заголовок %s у кириллического и длинного номера чата безопасный и стабильный", (_name, provider, header) => {
    for (const chatId of ["чат-42", "я".repeat(400)]) {
      const first = provider.requestOptions({ chatId }).headers?.[header];
      expect(first).toMatch(safe);
      expect(provider.requestOptions({ chatId }).headers?.[header]).toBe(first);
    }
  });
});
