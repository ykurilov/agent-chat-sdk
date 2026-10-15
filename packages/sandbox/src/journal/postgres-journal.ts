import { and, asc, eq, inArray, lt, notExists, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migratePostgresSchema } from "@ykurilov/agent-chat-core";
import type { Pool } from "pg";
import type { BlobRow, JournalStore, ModelCallRow, ToolCallRow } from "./journal-store";
import { sandboxAnswerEdits, sandboxBlobRefs, sandboxBlobs, sandboxModelCalls, sandboxSettings, sandboxToolCalls } from "./postgres-schema";

/** Постоянное число для блокировки базы миграциями журнала; не совпадает с ключом хранилища чатов. */
const MIGRATION_LOCK_KEY = 7_311_900_443;

/** Своя таблица учёта: хранилище чатов живёт в той же схеме и ведёт свою (`__drizzle_migrations`). */
const MIGRATIONS_TABLE = "__sandbox_migrations";

/**
 * Приводит таблицы журнала к последней миграции. Схема `agent_chat` создаётся под общей блокировкой всех пакетов, миграции — под своей:
 * копии пакета ждут друг друга, а разные пакеты стартуют разом на пустой базе без гонки за схему.
 */
export async function migrateJournalToLatest(pool: Pool, migrationsFolder: string): Promise<void> {
  await migratePostgresSchema({
    connect: () => pool.connect(),
    lockKey: MIGRATION_LOCK_KEY,
    migrate: (client) => migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat", migrationsTable: MIGRATIONS_TABLE }),
  });
}

/** Хранилище журнала в PostgreSQL (схема `agent_chat`). Закрытие закрывает и пул. */
export function createPostgresJournalStore(pool: Pool): JournalStore {
  const db = drizzle(pool);
  type Executor = Pick<typeof db, "delete" | "select" | "insert">;

  /** Куски, на которые не осталось ссылок. */
  async function dropUnreferencedBlobs(tx: Executor): Promise<void> {
    await tx.delete(sandboxBlobs).where(notExists(tx.select({ one: sandboxBlobRefs.hash }).from(sandboxBlobRefs).where(eq(sandboxBlobRefs.hash, sandboxBlobs.hash))));
  }

  /**
   * Куски обращения пишутся одним запросом: в длинном чате их сотни (вся история), и запрос на каждый кусок
   * превращал одну запись журнала в сотни походов к базе. Порядок по хэшу одинаков у всех записей —
   * параллельные записи с общими кусками не ждут друг друга крест-накрест.
   */
  async function saveBlobs(tx: Executor, callId: string, row: { chatId: string; ownerId: string }, hashes: string[], blobs: BlobRow[]): Promise<void> {
    const unique = [...new Map(blobs.map((blob) => [blob.hash, blob])).values()].sort((left, right) => (left.hash < right.hash ? -1 : left.hash > right.hash ? 1 : 0));
    if (unique.length > 0) {
      await tx
        .insert(sandboxBlobs)
        .values(unique.map((blob) => ({ hash: blob.hash, data: Buffer.from(blob.data), bytes: blob.bytes, truncated: blob.truncated })))
        .onConflictDoNothing();
    }
    const refs = [...new Set(hashes)].map((hash) => ({ callId, hash, chatId: row.chatId, ownerId: row.ownerId }));
    if (refs.length > 0) await tx.insert(sandboxBlobRefs).values(refs);
  }

  return {
    async saveModelCall(row, blobs) {
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(sandboxModelCalls).values({ ...row, error: withoutNul(row.error) }).onConflictDoNothing().returning({ id: sandboxModelCalls.id });
        if (inserted.length === 0) return;
        await saveBlobs(tx, row.id, row, [row.instructionsHash, ...row.messageHashes, row.toolsHash, row.settingsHash, row.responseHash], blobs);
      });
    },
    async saveToolCall(row, blobs) {
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(sandboxToolCalls).values({ ...row, error: withoutNul(row.error) }).onConflictDoNothing().returning({ id: sandboxToolCalls.id });
        if (inserted.length === 0) return;
        await saveBlobs(tx, row.id, row, row.outputHash ? [row.inputHash, row.outputHash] : [row.inputHash], blobs);
      });
    },
    async listModelCalls(chatId) {
      return db.select().from(sandboxModelCalls).where(eq(sandboxModelCalls.chatId, chatId)).orderBy(asc(sandboxModelCalls.startedAt));
    },
    async listToolCalls(chatId) {
      return db.select().from(sandboxToolCalls).where(eq(sandboxToolCalls.chatId, chatId)).orderBy(asc(sandboxToolCalls.startedAt));
    },
    async findModelCall(id) {
      return (await db.select().from(sandboxModelCalls).where(eq(sandboxModelCalls.id, id)).limit(1))[0] ?? null;
    },
    async findToolCall(id) {
      return (await db.select().from(sandboxToolCalls).where(eq(sandboxToolCalls.id, id)).limit(1))[0] ?? null;
    },
    async loadBlobs(hashes) {
      if (hashes.length === 0) return [];
      return (await db.select().from(sandboxBlobs).where(inArray(sandboxBlobs.hash, hashes))).map(toBlobRow);
    },
    async loadBlobForOwner(hash, ownerId) {
      const owned = await db.select({ hash: sandboxBlobRefs.hash }).from(sandboxBlobRefs).where(and(eq(sandboxBlobRefs.hash, hash), eq(sandboxBlobRefs.ownerId, ownerId))).limit(1);
      if (owned.length === 0) return null;
      const row = (await db.select().from(sandboxBlobs).where(eq(sandboxBlobs.hash, hash)).limit(1))[0];
      return row ? toBlobRow(row) : null;
    },
    async getSettings(chatId) {
      return (await db.select().from(sandboxSettings).where(eq(sandboxSettings.chatId, chatId)).limit(1))[0] ?? null;
    },
    async setSettings(settings) {
      const clean = { ...settings, instructions: withoutNul(settings.instructions) };
      await db.insert(sandboxSettings).values(clean).onConflictDoUpdate({ target: sandboxSettings.chatId, set: clean });
    },
    async saveAnswerEdit(record) {
      await db.insert(sandboxAnswerEdits).values(record).onConflictDoUpdate({ target: sandboxAnswerEdits.messageId, set: record });
    },
    async listAnswerEdits(chatId) {
      return db.select().from(sandboxAnswerEdits).where(eq(sandboxAnswerEdits.chatId, chatId)).orderBy(asc(sandboxAnswerEdits.editedAt));
    },
    async deleteChat(chatId) {
      await db.transaction(async (tx) => {
        await tx.delete(sandboxBlobRefs).where(eq(sandboxBlobRefs.chatId, chatId));
        await tx.delete(sandboxModelCalls).where(eq(sandboxModelCalls.chatId, chatId));
        await tx.delete(sandboxToolCalls).where(eq(sandboxToolCalls.chatId, chatId));
        await tx.delete(sandboxSettings).where(eq(sandboxSettings.chatId, chatId));
        await tx.delete(sandboxAnswerEdits).where(eq(sandboxAnswerEdits.chatId, chatId));
        await dropUnreferencedBlobs(tx);
      });
    },
    async deleteOlderThan(before) {
      return db.transaction(async (tx) => {
        const oldModels = tx.select({ id: sandboxModelCalls.id }).from(sandboxModelCalls).where(lt(sandboxModelCalls.startedAt, before));
        const oldTools = tx.select({ id: sandboxToolCalls.id }).from(sandboxToolCalls).where(lt(sandboxToolCalls.startedAt, before));
        await tx.delete(sandboxBlobRefs).where(or(inArray(sandboxBlobRefs.callId, oldModels), inArray(sandboxBlobRefs.callId, oldTools)));
        const models = await tx.delete(sandboxModelCalls).where(lt(sandboxModelCalls.startedAt, before)).returning({ id: sandboxModelCalls.id });
        const tools = await tx.delete(sandboxToolCalls).where(lt(sandboxToolCalls.startedAt, before)).returning({ id: sandboxToolCalls.id });
        await dropUnreferencedBlobs(tx);
        return models.length + tools.length;
      });
    },
    async close() {
      await pool.end();
    },
  };
}

/** PostgreSQL не хранит символ NUL в тексте: сообщение об ошибке или инструкция с ним отклонили бы запись. */
function withoutNul(text: string | null): string | null {
  return text === null ? null : text.replaceAll("\u0000", "");
}

function toBlobRow(row: typeof sandboxBlobs.$inferSelect): BlobRow {
  return { hash: row.hash, data: new Uint8Array(row.data), bytes: row.bytes, truncated: row.truncated };
}
