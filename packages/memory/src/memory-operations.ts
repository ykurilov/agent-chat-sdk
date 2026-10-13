import type { ChatStorage, ContextBlockEntry, MemoryError, MemoryNote, MemoryNoteInput } from "@ykurilov/agent-chat-core";
import { buildMemoryBlock, buildMemoryBlocks, shownNotesCount } from "./memory-block";
import { checkCanCreate, checkCanUpdate, parseNoteBatch, parseNoteInput } from "./note-rules";
import type { Checked, MemoryLimits } from "./note-rules";
import { createOwnerLock } from "./owner-lock";
import type { OwnerLock } from "./owner-lock";
import { searchNotes } from "./search-notes";

/** Методы хранилища, без которых память не работает. */
export const requiredStorageMethods = ["listMemoryNotes", "insertMemoryNotes", "updateMemoryNote", "deleteMemoryNote", "clearMemoryNotes"] as const;

export type MemoryStorage = ChatStorage &
  Required<Pick<ChatStorage, (typeof requiredStorageMethods)[number]>>;

export interface MemoryCounts {
  /** Записей всего. */
  total: number;
  /** Предел записей. */
  limit: number;
  /** Сколько записей попадает в запрос (остальные находятся поиском). */
  shown: number;
}

const staleVersion: MemoryError = {
  kind: "stale_version",
  message: "Запись изменилась после того, как ты её видел. Найди её заново действием search и повтори с новой версией.",
};
const notFound: MemoryError = { kind: "not_found", message: "Такой записи нет. Найди её заново действием search." };

function requireOwner(ownerId: string): void {
  if (!ownerId) throw new Error("Память без номера человека: записи некому принадлежать");
}

/**
 * Действия над памятью одного человека: одни и те же для агента (инструмент) и для сервера (экран).
 *
 * Пределы и дубли проверяются там, где записи не могут измениться между проверкой и записью: внутри операции
 * хранилища, если оно так умеет (это держит и несколько серверов на одной базе), а иначе — под замком на человека
 * в этом процессе (для одного сервера этого хватает). `lock` общий с возвратом слияний.
 */
export function createMemoryOperations(storage: MemoryStorage, limits: MemoryLimits, lock: OwnerLock = createOwnerLock()) {
  const notesOf = (ownerId: string) => {
    requireOwner(ownerId);
    return storage.listMemoryNotes(ownerId);
  };

  async function createMany(ownerId: string, inputs: unknown): Promise<Checked<MemoryNote[]>> {
    const parsed = parseNoteBatch(inputs, limits);
    if (!parsed.ok) return parsed;
    const added = parsed.value;
    return lock(ownerId, async () => {
      requireOwner(ownerId);
      if (storage.insertMemoryNotesChecked) {
        const result = await storage.insertMemoryNotesChecked(ownerId, added, (existing) => checkCanCreate(existing, added, limits));
        return Array.isArray(result) ? { ok: true, value: result } : { ok: false, error: result };
      }
      const error = checkCanCreate(await storage.listMemoryNotes(ownerId), added, limits);
      if (error) return { ok: false, error };
      return { ok: true, value: await storage.insertMemoryNotes(ownerId, added) };
    });
  }

  return {
    async list(ownerId: string): Promise<{ notes: MemoryNote[]; counts: MemoryCounts }> {
      const notes = await notesOf(ownerId);
      return { notes, counts: { total: notes.length, limit: limits.maxNotes, shown: shownNotesCount(notes, limits.maxBlockChars) } };
    },

    createMany,

    async create(ownerId: string, input: unknown): Promise<Checked<MemoryNote>> {
      const parsed = parseNoteInput(input);
      if (!parsed.ok) return parsed;
      const created = await createMany(ownerId, [parsed.value]);
      return created.ok ? { ok: true, value: created.value[0]! } : created;
    },

    async update(ownerId: string, id: string, version: number, input: unknown): Promise<Checked<MemoryNote>> {
      const parsed = parseNoteInput(input);
      if (!parsed.ok) return parsed;
      const next: MemoryNoteInput = parsed.value;
      return lock(ownerId, async () => {
        requireOwner(ownerId);
        let result;
        if (storage.updateMemoryNoteChecked) {
          result = await storage.updateMemoryNoteChecked(ownerId, id, version, next, (existing) => checkCanUpdate(existing, id, next, limits));
        } else {
          const error = checkCanUpdate(await storage.listMemoryNotes(ownerId), id, next, limits);
          if (error) return { ok: false, error };
          result = await storage.updateMemoryNote(ownerId, id, version, next);
        }
        if (result === "not_found") return { ok: false, error: notFound };
        if (result === "stale_version") return { ok: false, error: staleVersion };
        if ("kind" in result) return { ok: false, error: result };
        return { ok: true, value: result };
      });
    },

    async remove(ownerId: string, id: string, version: number): Promise<Checked<{ deleted: string }>> {
      requireOwner(ownerId);
      const result = await storage.deleteMemoryNote(ownerId, id, version);
      if (result === "not_found") return { ok: false, error: notFound };
      if (result === "stale_version") return { ok: false, error: staleVersion };
      return { ok: true, value: { deleted: id } };
    },

    async clear(ownerId: string): Promise<number> {
      requireOwner(ownerId);
      return storage.clearMemoryNotes(ownerId);
    },

    async search(ownerId: string, query: string): Promise<Checked<{ notes: MemoryNote[]; total: number }>> {
      return searchNotes(await notesOf(ownerId), query, limits.searchLimit);
    },

    async snapshot(ownerId: string): Promise<string | null> {
      return buildMemoryBlock(await notesOf(ownerId), limits.maxBlockChars);
    },

    async blocks(ownerId: string): Promise<ContextBlockEntry[] | null> {
      return buildMemoryBlocks(await notesOf(ownerId), limits.maxBlockChars);
    },
  };
}

export type MemoryOperations = ReturnType<typeof createMemoryOperations>;
