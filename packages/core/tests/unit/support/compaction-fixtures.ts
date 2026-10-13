import { newStoredMessage } from "../../../src/conversation/types";
import type { StoredCompaction, StoredMessage } from "../../../src/conversation/types";

const start = Date.parse("2026-01-01T00:00:00.000Z");
export const timeAt = (second: number) => new Date(start + second * 1000).toISOString();

/**
 * Ветка «вопрос — ответ» на каждый элемент `contexts`: вопросы `u1…`, ответы `a1…`. Число — размер контекста
 * после ответа (`usage.contextTokens`); `null` — провайдер числа не дал. Время идёт по секунде на сообщение.
 */
export function conversation(contexts: Array<number | null>, chatId = "chat-1"): StoredMessage[] {
  return contexts.flatMap((context, index) => {
    const question = newStoredMessage({
      id: `u${index + 1}`,
      chatId,
      role: "user",
      parentId: index === 0 ? null : `a${index}`,
      parts: [{ type: "text", text: `вопрос ${index + 1}` }],
      createdAt: timeAt(index * 2),
    });
    const answer = newStoredMessage({
      id: `a${index + 1}`,
      chatId,
      role: "assistant",
      parentId: question.id,
      parts: [{ type: "text", text: `ответ ${index + 1}` }],
      usage:
        context === null
          ? null
          : { inputTokens: context - 10, cachedInputTokens: 0, outputTokens: 10, reasoningTokens: 0, contextTokens: context },
      modelId: "mock-model",
      providerId: "mock",
      createdAt: timeAt(index * 2 + 1),
    });
    return [question, answer];
  });
}

export function compactionRecord(fields: Partial<StoredCompaction> & Pick<StoredCompaction, "id" | "throughMessageId">): StoredCompaction {
  return {
    chatId: "chat-1",
    fromMessageId: "u1",
    summary: `сводка ${fields.id}`,
    summaryTokens: 100,
    modelId: "mock-model",
    providerId: "mock",
    usage: null,
    createdAt: timeAt(1000),
    ...fields,
  };
}
