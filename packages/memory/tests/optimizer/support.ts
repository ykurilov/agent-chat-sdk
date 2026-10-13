import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { MemoryNote, MemoryNoteInput } from "@ykurilov/agent-chat-core";
import { vi } from "vitest";
import { defaultMemoryLimits } from "../../src/note-rules";

export const limits = defaultMemoryLimits;

const MINUTE = 60_000;
/** Момент запуска: минуты от условного начала; часы оптимизатора в тестах задаём сами. */
export const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1) + minutes * MINUTE);
export const isoAt = (minutes: number) => at(minutes).toISOString();

/** Запись снимка для проверки плана: всё, что не названо, — по умолчанию. */
export function snapshotNote(id: string, content: string, categories = ["О себе"], version = 1): MemoryNote {
  return { id, categories, content, version, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

export const input = (content: string, categories = ["О себе"]): MemoryNoteInput => ({ categories, content });

export interface ProposalGroup {
  sourceIds: string[];
  categories: string[];
  content: string;
}
export const proposalOf = (...groups: ProposalGroup[]) => ({ groups });

/** Ответ модели-заглушки: текст и итог провайдера. */
export function generateReply(text: string, options: { finish?: "stop" | "length"; input?: number; output?: number } = {}) {
  const { finish = "stop", input = 120, output = 40 } = options;
  return {
    content: text === "" ? [] : [{ type: "text" as const, text }],
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: output, text: output, reasoning: 0 },
    },
    warnings: [],
  };
}

type Reply = ReturnType<typeof generateReply>;
export type Answer = object | string | Error | Reply;

const isReply = (answer: Answer): answer is Reply => typeof answer === "object" && "finishReason" in answer;

/**
 * Модель оптимизатора по сценарию: предложение (объект или текст), ошибка или готовый ответ.
 * Функция получает запрос, чтобы тест мог, например, поменять записи, пока «модель думает».
 */
export function optimizerModel(answer: Answer | ((call: LanguageModelV4CallOptions) => Promise<Answer> | Answer)) {
  const doGenerate = vi.fn(async (call: LanguageModelV4CallOptions) => {
    const next = typeof answer === "function" ? await answer(call) : answer;
    if (next instanceof Error) throw next;
    if (isReply(next)) return next;
    return generateReply(typeof next === "string" ? next : JSON.stringify(next));
  });
  return new MockLanguageModelV4({ doGenerate });
}

/** Хранилище в памяти с записями человека `anna`; возвращает записи в том порядке, в каком заданы. */
export async function storageWith(contents: ReadonlyArray<readonly [content: string, ...categories: string[]] | MemoryNoteInput>, ownerId = "anna") {
  const storage = createInMemoryChatStorage();
  const inputs = contents.map((item) => (Array.isArray(item) ? input(item[0], item.length > 1 ? item.slice(1) : ["О себе"]) : (item as MemoryNoteInput)));
  const notes = await storage.insertMemoryNotes!(ownerId, inputs);
  return { storage, notes };
}

/** Тексты сообщений запроса к модели: для проверки, что и куда попало. */
export function promptText(call: LanguageModelV4CallOptions): { system: string; user: string } {
  const parts = (role: string) =>
    call.prompt
      .filter((message) => message.role === role)
      .map((message) => (typeof message.content === "string" ? message.content : message.content.map((part) => ("text" in part ? part.text : "")).join("")))
      .join("\n");
  return { system: parts("system"), user: parts("user") };
}
