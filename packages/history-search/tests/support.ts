import type { ToolExecutionOptions } from "ai";
import { CURRENT_FORMAT_VERSION } from "@ykurilov/agent-chat-core";
import type { ChatStorage, StoredCompaction, StoredMessage } from "@ykurilov/agent-chat-core";

export const chatId = "chat-1";

export function executeOptions(): ToolExecutionOptions<unknown> {
  return { toolCallId: "call-1", messages: [], context: undefined };
}

const start = Date.parse("2026-03-01T10:00:00.000Z");
const timeAt = (minute: number) => new Date(start + minute * 60_000).toISOString();

function message(fields: Pick<StoredMessage, "id" | "chatId" | "role" | "parts" | "parentId" | "createdAt">): StoredMessage {
  return {
    ...fields,
    formatVersion: CURRENT_FORMAT_VERSION,
    status: "complete",
    modelId: fields.role === "assistant" ? "m" : null,
    providerId: fields.role === "assistant" ? "p" : null,
    usage: null,
    reasoningDurationsMs: {},
    error: null,
  };
}

export function userMessage(id: string, text: string, minute: number, parentId: string | null = null, chat = chatId): StoredMessage {
  return message({ id, chatId: chat, parentId, role: "user", parts: [{ type: "text", text }], createdAt: timeAt(minute) });
}

export function assistantMessage(id: string, parentId: string, parts: StoredMessage["parts"], minute: number, chat = chatId): StoredMessage {
  return message({ id, chatId: chat, parentId, role: "assistant", parts, createdAt: timeAt(minute) });
}

export function compactionThrough(throughMessageId: string, chat = chatId, from = "u1"): StoredCompaction {
  return {
    id: `c-${throughMessageId}`,
    chatId: chat,
    fromMessageId: from,
    throughMessageId,
    summary: "сводка",
    summaryTokens: 10,
    modelId: "m",
    providerId: "p",
    usage: null,
    createdAt: timeAt(500),
  };
}

/** Чат из пар «вопрос — ответ»: id u1, a1, u2, a2… (с приставкой, если чатов несколько); время — минута на сообщение. */
export async function seedChat(
  storage: ChatStorage,
  turns: Array<[question: string, answer: StoredMessage["parts"] | string]>,
  chat = chatId,
  idPrefix = "",
): Promise<void> {
  await storage.createChat({ id: chat, ownerId: "anna", modelId: "m", providerId: "p" });
  let parent: string | null = null;
  for (const [index, [question, answer]] of turns.entries()) {
    const asked = userMessage(`${idPrefix}u${index + 1}`, question, index * 2, parent, chat);
    const answered = assistantMessage(
      `${idPrefix}a${index + 1}`,
      asked.id,
      typeof answer === "string" ? [{ type: "text", text: answer }] : answer,
      index * 2 + 1,
      chat,
    );
    await storage.insertMessage(asked);
    await storage.insertMessage(answered);
    parent = answered.id;
  }
}
