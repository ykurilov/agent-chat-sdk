import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { MemoryOperations } from "./memory-operations";

const inputSchema = z.object({
  action: z.enum(["create", "update", "delete", "search"]).describe("Что сделать с памятью."),
  notes: z
    .array(z.object({ categories: z.array(z.string()), content: z.string() }))
    .optional()
    .describe("create: записи (от 1 до 5); у каждой от 1 до 3 разделов и текст."),
  id: z.string().optional().describe("update, delete: id записи из блока памяти или из поиска."),
  version: z.number().optional().describe("update, delete: версия записи, которую ты видел."),
  categories: z.array(z.string()).optional().describe("update: новые разделы (от 1 до 3)."),
  content: z.string().optional().describe("update: новый текст записи."),
  query: z.string().optional().describe("search: слова, которые могли стоять в записи."),
});

type Input = z.infer<typeof inputSchema>;

const description =
  "Долгая память о человеке между чатами. create — записать факты или правила (до 5 записей одним вызовом); update — заменить запись (нужны id и version); delete — удалить запись (id и version); search — найти записи по словам. Ошибки приходят ответом с полем error: прочти подсказку и повтори.";

const invalid = (message: string) => ({ error: { kind: "invalid" as const, message } });

/** Инструмент `manage_memory` для одного человека. Описание и схема не зависят от него: начало запроса кэшируется. */
export function createManageMemoryTool(operations: MemoryOperations, ownerId: string): ToolSet {
  return {
    manage_memory: tool({
      description,
      inputSchema,
      execute: async (input: Input) => run(operations, ownerId, input),
    }),
  };
}

async function run(operations: MemoryOperations, ownerId: string, input: Input) {
  switch (input?.action) {
    case "create": {
      const created = await operations.createMany(ownerId, input.notes);
      return created.ok ? { notes: created.value } : { error: created.error };
    }
    case "update": {
      if (typeof input.id !== "string" || typeof input.version !== "number") return invalid("Для update нужны id и version записи.");
      const updated = await operations.update(ownerId, input.id, input.version, { categories: input.categories, content: input.content });
      return updated.ok ? { note: updated.value } : { error: updated.error };
    }
    case "delete": {
      if (typeof input.id !== "string" || typeof input.version !== "number") return invalid("Для delete нужны id и version записи.");
      const removed = await operations.remove(ownerId, input.id, input.version);
      return removed.ok ? removed.value : { error: removed.error };
    }
    case "search": {
      const found = await operations.search(ownerId, input.query as string);
      return found.ok ? found.value : { error: found.error };
    }
    default:
      return invalid("Неизвестное действие: доступны create, update, delete, search.");
  }
}
