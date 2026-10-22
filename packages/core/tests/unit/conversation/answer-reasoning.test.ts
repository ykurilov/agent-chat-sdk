import { describe, expect, it } from "vitest";
import { withAnswerReasoning, answerReasoningOf } from "../../../src/conversation/answer-reasoning";
import { toAgentChatMessage } from "../../../src/conversation/to-agent-chat-message";
import { newStoredMessage } from "../../../src/conversation/types";

describe("уровень рассуждений завершённого ответа", () => {
  it("сохраняет уровень рядом с частями без миграции базы и обновляет его при продолжении", () => {
    const parts = [{ type: "text" as const, text: "Ответ" }];
    expect(withAnswerReasoning(parts, undefined)).toBe(parts);
    const saved = withAnswerReasoning(withAnswerReasoning(parts, "low"), "high");
    expect(answerReasoningOf(saved)).toBe("high");
    expect(saved).toHaveLength(2);
  });
  it("возвращает уровень в metadata, а служебную часть не отдаёт экрану или модели", () => {
    const message = newStoredMessage({ id: "a", chatId: "c", role: "assistant", parts: withAnswerReasoning([{ type: "text", text: "Ответ" }], "medium") });
    const view = toAgentChatMessage(message);
    expect(view.metadata?.reasoningLevel).toBe("medium");
    expect(view.parts).toEqual([{ type: "text", text: "Ответ" }]);
  });
});
