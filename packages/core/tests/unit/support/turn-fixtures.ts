import type { UIMessageChunk } from "ai";
import type { MockLanguageModelV4 } from "ai/test";
import { runAgentTurn } from "../../../src/agent-run/run-agent-turn";
import { todayBlock } from "../../../src/agent-run/today";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import { newStoredMessage } from "../../../src/conversation/types";
import type { StoredMessage } from "../../../src/conversation/types";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModelId, readAll } from "./mock-model";

export const chatId = "chat-1";

/** Часы хода в тестах: дата в хвосте запроса одна и та же в любой день прогона. */
export const testNow = () => new Date(2026, 0, 1, 12);
/** Часть с датой в конце последнего сообщения человека при `testNow`. */
export const TODAY = todayBlock(testNow());

const question = newStoredMessage({
  id: "u1",
  chatId,
  role: "user",
  parts: [{ type: "text", text: "Привет" }],
  createdAt: "2026-01-01T00:00:00.000Z",
});

/** Хранилище с чатом и вопросом собеседника «u1». */
export async function storageWithQuestion(): Promise<ChatStorage> {
  const storage = createInMemoryChatStorage();
  await storage.createChat({ id: chatId, ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  await storage.insertMessage(question);
  return storage;
}

/** Ход агента «a1» в ответ на «u1» с моделью-заглушкой; `extra` меняет поля хода. */
export function startTurn(storage: ChatStorage, model: MockLanguageModelV4, extra: Partial<AgentTurnInput> = {}) {
  return runAgentTurn({
    storage,
    catalog: mockCatalog({ mock: model }),
    env: mockEnv,
    chatId,
    messageId: "a1",
    parentId: "u1",
    modelId: mockModelId,
    providerId: "mock",
    instructions: "Ты помощник.",
    history: [{ id: "u1", role: "user", parts: question.parts }],
    abortSignal: new AbortController().signal,
    now: testNow,
    ...extra,
  });
}

export async function savedAnswer(storage: ChatStorage): Promise<StoredMessage | undefined> {
  return (await storage.listMessages(chatId)).find((message) => message.id === "a1");
}

/** Ход целиком: куски потока и сохранённый ответ. */
export async function runTurn(model: MockLanguageModelV4, extra: Partial<AgentTurnInput> = {}) {
  const storage = await storageWithQuestion();
  const chunks = await readAll(startTurn(storage, model, extra));
  const answer = await savedAnswer(storage);
  if (!answer) throw new Error("ответ не сохранён");
  return { storage, chunks, answer };
}

/** Весь текст из частей сообщения. */
export const textOf = (parts: StoredMessage["parts"]) => parts.map((part) => (part.type === "text" ? part.text : "")).join("");

/**
 * Куски хода без подробностей сбоя (`error.details` в метаданных): так их видит браузер без права `errorDetails`.
 * Текст провайдера ход кладёт только туда.
 */
export function withoutErrorDetails(chunks: UIMessageChunk[]): UIMessageChunk[] {
  return chunks.map((chunk) => {
    const metadata = (chunk as { messageMetadata?: { error?: { details?: unknown } } }).messageMetadata;
    if (!metadata?.error?.details) return chunk;
    const { details: _details, ...error } = metadata.error;
    return { ...chunk, messageMetadata: { ...metadata, error } } as UIMessageChunk;
  });
}
