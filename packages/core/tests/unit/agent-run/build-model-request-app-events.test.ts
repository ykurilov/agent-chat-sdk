import { describe, expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { standardCatalog } from "../../../src/models/standard-catalog";

const ask = (id: string, text: string): AgentChatMessage => ({ id, role: "user", parts: [{ type: "text", text }] });

function requestOf(history: AgentChatMessage[]) {
  return buildModelRequest({
    catalog: standardCatalog,
    modelId: "deepseek-4.1-flash",
    providerId: "deepseek",
    chatId: "c",
    instructions: "Ты помощник.",
    history,
    env: { DEEPSEEK_API_KEY: "k" },
  });
}

describe("buildModelRequest: события приложения", () => {
  it("часть data-app-event модели не уходит: запрос побайтно как без неё", async () => {
    const answer = (withEvent: boolean): AgentChatMessage => ({
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Зачёт!" },
        ...(withEvent ? [{ type: "data-app-event", data: { type: "lesson_passed", data: { lesson: 3 } } } as AgentChatMessage["parts"][number]] : []),
      ],
    });
    const withEvent = await requestOf([ask("u1", "зачёт"), answer(true), ask("u2", "дальше")]);
    const withoutEvent = await requestOf([ask("u1", "зачёт"), answer(false), ask("u2", "дальше")]);
    expect(JSON.stringify(withEvent.messages)).toBe(JSON.stringify(withoutEvent.messages));
    expect(JSON.stringify(withEvent.messages)).not.toContain("lesson_passed");
  });
});

describe("buildModelRequest: ответ без текста с событием хука", () => {
  it("остановлен до первого слова, в ответе только событие: модели не уходит, пустых сообщений нет", async () => {
    const stopped = (parts: AgentChatMessage["parts"]): AgentChatMessage => ({ id: "a1", role: "assistant", parts, metadata: { status: "stopped" } });
    const event = { type: "data-app-event", data: { type: "lesson_passed" } } as AgentChatMessage["parts"][number];
    const withEvent = await requestOf([ask("u1", "зачёт"), stopped([event]), ask("u2", "дальше")]);
    const empty = await requestOf([ask("u1", "зачёт"), stopped([]), ask("u2", "дальше")]);

    expect(JSON.stringify(withEvent.messages)).toBe(JSON.stringify(empty.messages));
    expect(JSON.stringify(withEvent.messages)).not.toContain("lesson_passed");
    for (const message of withEvent.messages) {
      expect(typeof message.content === "string" ? message.content.length : message.content.length).toBeGreaterThan(0);
    }
    expect(withEvent.messages.at(-1)).toMatchObject({ role: "user" });
  });
});
