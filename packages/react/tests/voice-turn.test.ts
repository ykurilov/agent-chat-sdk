import { describe, expect, it } from "vitest";
import type { AgentChatMessage } from "../src/chat-types";
import { messageText } from "../src/chat-types";
import { voiceAnswerIds } from "../src/voice-turn";

const user = (id: string, voice: boolean): AgentChatMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text: "слова" }, ...(voice ? [{ type: "data-voice-mode" as const, data: true }] : [])],
});
const answer = (id: string, text = "[laughs] ответ [docs]"): AgentChatMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
  metadata: { status: "complete" },
});

describe("ответы голосовых ходов", () => {
  it("голосовой ход — ответ на сообщение человека с отметкой голосового режима", () => {
    expect([...voiceAnswerIds([user("u1", true), answer("a1"), user("u2", false), answer("a2"), user("u3", true), answer("a3")])]).toEqual(["a1", "a3"]);
  });

  it("несколько сообщений агента подряд (после инструмента) принадлежат тому же ходу", () => {
    expect([...voiceAnswerIds([user("u1", true), answer("a1"), answer("a2")])]).toEqual(["a1", "a2"]);
  });

  it("ответ без вопроса перед ним голосовым не считается", () => {
    expect(voiceAnswerIds([answer("a1")]).size).toBe(0);
  });

  it("messageText вырезает теги только у ответа голосового хода", () => {
    expect(messageText(answer("a1"), { voiceAnswer: true })).toBe("ответ");
    expect(messageText(answer("a1"))).toBe("[laughs] ответ [docs]");
    expect(messageText(user("u1", true), { voiceAnswer: true })).toBe("слова");
  });
});
