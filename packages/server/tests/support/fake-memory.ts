import { vi } from "vitest";
import type { MemoryError, MemoryErrorKind, MemoryNote, MemoryNoteInput } from "@ykurilov/agent-chat-core";
import type { ChatMemory } from "../../src/chat-handler";

/** Запись, как её отдаёт хранилище: с лишними служебными полями, которых на экран выдавать нельзя. */
type StoredNote = MemoryNote & { ownerId: string; internalKey: string };

const messages: Record<MemoryErrorKind, string> = {
  not_found: "Такой записи нет.",
  stale_version: "Запись изменилась.",
  invalid: "Форма записи неверна.",
  duplicate: "Такая запись уже есть.",
  limit_reached: "Записей слишком много.",
};
const failure = (kind: MemoryErrorKind) => ({ ok: false as const, error: { kind, message: messages[kind] } satisfies MemoryError });

/**
 * Память на словаре: правила те же, что у пакета памяти (форма, дубль, предел, версия, владелец),
 * но без импорта пакета. Записи хранятся со служебными полями `ownerId` и `internalKey`.
 */
export function fakeMemory(options: { limit?: number; shown?: number } = {}) {
  const limit = options.limit ?? 3;
  const stored: StoredNote[] = [];
  let counter = 0;
  const notesOf = (ownerId: string) => stored.filter((note) => note.ownerId === ownerId);
  const isForm = (input: unknown): input is MemoryNoteInput => {
    const { categories, content } = (input ?? {}) as Partial<MemoryNoteInput>;
    return Array.isArray(categories) && categories.length > 0 && categories.every((c) => typeof c === "string" && c !== "") && typeof content === "string" && content.trim() !== "";
  };

  const memory: ChatMemory = {
    instructions: "Память: пользуйся manage_memory.",
    tools: () => ({}),
    toolNames: ["manage_memory"],
    snapshot: vi.fn(async () => null),
    list: vi.fn(async (ownerId: string) => {
      const notes = notesOf(ownerId);
      return { notes, counts: { total: notes.length, limit, shown: Math.min(notes.length, options.shown ?? notes.length) } };
    }),
    create: vi.fn(async (ownerId: string, input: unknown) => {
      if (!isForm(input)) return failure("invalid");
      if (notesOf(ownerId).length >= limit) return failure("limit_reached");
      if (notesOf(ownerId).some((note) => note.content === input.content)) return failure("duplicate");
      counter += 1;
      const now = "2026-09-30T10:00:00.000Z";
      const note: StoredNote = { id: `n${counter}`, version: 1, categories: input.categories, content: input.content, createdAt: now, updatedAt: now, ownerId, internalKey: "секрет-хранилища" };
      stored.push(note);
      return { ok: true as const, value: note };
    }),
    update: vi.fn(async (ownerId: string, id: string, version: number, input: unknown) => {
      if (!isForm(input)) return failure("invalid");
      const note = notesOf(ownerId).find((item) => item.id === id);
      if (!note) return failure("not_found");
      if (note.version !== version) return failure("stale_version");
      if (notesOf(ownerId).some((other) => other.id !== id && other.content === input.content)) return failure("duplicate");
      Object.assign(note, { categories: input.categories, content: input.content, version: note.version + 1 });
      return { ok: true as const, value: note };
    }),
    remove: vi.fn(async (ownerId: string, id: string, version: number) => {
      const note = notesOf(ownerId).find((item) => item.id === id);
      if (!note) return failure("not_found");
      if (note.version !== version) return failure("stale_version");
      stored.splice(stored.indexOf(note), 1);
      return { ok: true as const, value: { deleted: id } };
    }),
    clear: vi.fn(async (ownerId: string) => {
      const mine = notesOf(ownerId);
      for (const note of mine) stored.splice(stored.indexOf(note), 1);
      return mine.length;
    }),
  };
  return { memory, stored };
}
