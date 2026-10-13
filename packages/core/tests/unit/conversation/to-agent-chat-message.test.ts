import { describe, expect, it } from "vitest";
import { toAgentChatMessage } from "../../../src/conversation/to-agent-chat-message";
import { newStoredMessage } from "../../../src/conversation/types";

describe("toAgentChatMessage: расход в метаданных для экрана", () => {
  it("идущий ответ отдаёт расход без шагов хода: шаги с провайдерами нужны только восстановлению", () => {
    const usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 30, reasoningTokens: 0 };
    const message = toAgentChatMessage(
      newStoredMessage({
        id: "a1",
        chatId: "c1",
        role: "assistant",
        status: "streaming",
        usage: { ...usage, pendingSteps: [{ ...usage, providerId: "openrouter" }] },
      }),
    );
    expect(message.metadata?.usage).toEqual(usage);
  });
});
