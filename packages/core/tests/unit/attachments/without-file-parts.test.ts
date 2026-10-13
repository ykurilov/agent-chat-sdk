import { describe, expect, it } from "vitest";
import { withoutFileParts } from "../../../src/attachments/message-attachments";
import type { AgentChatMessage } from "../../../src/conversation/types";

const file = { type: "file" as const, url: "attachment:1", mediaType: "image/png", filename: "a.png" };

describe("withoutFileParts", () => {
  it("убирает части file и оставляет текст", () => {
    const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [file, { type: "text", text: "Что тут?" }] }];
    expect(withoutFileParts(history)[0]!.parts).toEqual([{ type: "text", text: "Что тут?" }]);
  });

  it("сообщение только из файлов получает пометку, чтобы запрос не был пустым", () => {
    const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [file] }];
    expect(withoutFileParts(history)[0]!.parts).toEqual([{ type: "text", text: "[Вложение недоступно.]" }]);
  });

  it("сообщения без файлов возвращает как есть", () => {
    const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }];
    expect(withoutFileParts(history)[0]).toBe(history[0]);
  });
});
