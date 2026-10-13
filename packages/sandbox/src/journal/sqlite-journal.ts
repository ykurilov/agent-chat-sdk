import type Database from "better-sqlite3";
import { and, asc, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BlobRow, JournalStore, ModelCallRow, ToolCallRow } from "./journal-store";
import { sandboxAnswerEdits, sandboxBlobRefs, sandboxBlobs, sandboxModelCalls, sandboxSettings, sandboxToolCalls } from "./sqlite-schema";

/** Своя таблица учёта: хранилище чатов живёт в той же базе и ведёт свою (`__agent_chat_migrations`). */
const MIGRATIONS_TABLE = "__sandbox_migrations";

/** Хранилище журнала в SQLite. Схема приводится к последней миграции при создании. */
export function createSqliteJournalStore(sqlite: Database.Database, migrationsFolder: string): JournalStore {
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder, migrationsTable: MIGRATIONS_TABLE });

  /** Куски, на которые не осталось ссылок. */
  function dropUnreferencedBlobs(tx: Pick<typeof db, "delete" | "select">): void {
    tx.delete(sandboxBlobs).where(notInArray(sandboxBlobs.hash, tx.select({ hash: sandboxBlobRefs.hash }).from(sandboxBlobRefs))).run();
  }

  function saveBlobs(tx: Pick<typeof db, "insert">, callId: string, row: { chatId: string; ownerId: string }, hashes: string[], blobs: BlobRow[]): void {
    for (const blob of blobs) tx.insert(sandboxBlobs).values({ hash: blob.hash, data: Buffer.from(blob.data), bytes: blob.bytes, truncated: blob.truncated }).onConflictDoNothing().run();
    for (const hash of new Set(hashes)) tx.insert(sandboxBlobRefs).values({ callId, hash, chatId: row.chatId, ownerId: row.ownerId }).run();
  }

  return {
    async saveModelCall(row, blobs) {
      db.transaction((tx) => {
        const inserted = tx.insert(sandboxModelCalls).values(modelValues(row)).onConflictDoNothing().run();
        if (inserted.changes === 0) return;
        saveBlobs(tx, row.id, row, [row.instructionsHash, ...row.messageHashes, row.toolsHash, row.settingsHash, row.responseHash], blobs);
      });
    },
    async saveToolCall(row, blobs) {
      db.transaction((tx) => {
        const inserted = tx.insert(sandboxToolCalls).values(toolValues(row)).onConflictDoNothing().run();
        if (inserted.changes === 0) return;
        saveBlobs(tx, row.id, row, row.outputHash ? [row.inputHash, row.outputHash] : [row.inputHash], blobs);
      });
    },
    async listModelCalls(chatId) {
      return db.select().from(sandboxModelCalls).where(eq(sandboxModelCalls.chatId, chatId)).orderBy(asc(sandboxModelCalls.startedAt)).all().map(toModelRow);
    },
    async listToolCalls(chatId) {
      return db.select().from(sandboxToolCalls).where(eq(sandboxToolCalls.chatId, chatId)).orderBy(asc(sandboxToolCalls.startedAt)).all().map(toToolRow);
    },
    async findModelCall(id) {
      const row = db.select().from(sandboxModelCalls).where(eq(sandboxModelCalls.id, id)).get();
      return row ? toModelRow(row) : null;
    },
    async findToolCall(id) {
      const row = db.select().from(sandboxToolCalls).where(eq(sandboxToolCalls.id, id)).get();
      return row ? toToolRow(row) : null;
    },
    async loadBlobs(hashes) {
      if (hashes.length === 0) return [];
      return db.select().from(sandboxBlobs).where(inArray(sandboxBlobs.hash, hashes)).all().map(toBlobRow);
    },
    async loadBlobForOwner(hash, ownerId) {
      const owned = db.select({ hash: sandboxBlobRefs.hash }).from(sandboxBlobRefs).where(and(eq(sandboxBlobRefs.hash, hash), eq(sandboxBlobRefs.ownerId, ownerId))).limit(1).get();
      if (!owned) return null;
      const row = db.select().from(sandboxBlobs).where(eq(sandboxBlobs.hash, hash)).get();
      return row ? toBlobRow(row) : null;
    },
    async getSettings(chatId) {
      const row = db.select().from(sandboxSettings).where(eq(sandboxSettings.chatId, chatId)).get();
      return row ? { chatId: row.chatId, instructions: row.instructions, updatedBy: row.updatedBy, updatedAt: new Date(row.updatedAt) } : null;
    },
    async setSettings(settings) {
      const values = { chatId: settings.chatId, instructions: settings.instructions, updatedBy: settings.updatedBy, updatedAt: settings.updatedAt.getTime() };
      db.insert(sandboxSettings).values(values).onConflictDoUpdate({ target: sandboxSettings.chatId, set: values }).run();
    },
    async saveAnswerEdit(record) {
      const values = { ...record, editedAt: record.editedAt.getTime() };
      db.insert(sandboxAnswerEdits).values(values).onConflictDoUpdate({ target: sandboxAnswerEdits.messageId, set: values }).run();
    },
    async listAnswerEdits(chatId) {
      return db
        .select()
        .from(sandboxAnswerEdits)
        .where(eq(sandboxAnswerEdits.chatId, chatId))
        .orderBy(asc(sandboxAnswerEdits.editedAt))
        .all()
        .map((row) => ({ ...row, editedAt: new Date(row.editedAt) }));
    },
    async deleteChat(chatId) {
      db.transaction((tx) => {
        tx.delete(sandboxBlobRefs).where(eq(sandboxBlobRefs.chatId, chatId)).run();
        tx.delete(sandboxModelCalls).where(eq(sandboxModelCalls.chatId, chatId)).run();
        tx.delete(sandboxToolCalls).where(eq(sandboxToolCalls.chatId, chatId)).run();
        tx.delete(sandboxSettings).where(eq(sandboxSettings.chatId, chatId)).run();
        tx.delete(sandboxAnswerEdits).where(eq(sandboxAnswerEdits.chatId, chatId)).run();
        dropUnreferencedBlobs(tx);
      });
    },
    async deleteOlderThan(before) {
      const cutoff = before.getTime();
      return db.transaction((tx) => {
        const oldModels = tx.select({ id: sandboxModelCalls.id }).from(sandboxModelCalls).where(lt(sandboxModelCalls.startedAt, cutoff));
        const oldTools = tx.select({ id: sandboxToolCalls.id }).from(sandboxToolCalls).where(lt(sandboxToolCalls.startedAt, cutoff));
        tx.delete(sandboxBlobRefs).where(or(inArray(sandboxBlobRefs.callId, oldModels), inArray(sandboxBlobRefs.callId, oldTools))).run();
        const models = tx.delete(sandboxModelCalls).where(lt(sandboxModelCalls.startedAt, cutoff)).run().changes;
        const tools = tx.delete(sandboxToolCalls).where(lt(sandboxToolCalls.startedAt, cutoff)).run().changes;
        dropUnreferencedBlobs(tx);
        return models + tools;
      });
    },
    async close() {
      sqlite.close();
    },
  };
}

function modelValues(row: ModelCallRow): typeof sandboxModelCalls.$inferInsert {
  return { ...row, startedAt: row.startedAt.getTime() };
}

function toolValues(row: ToolCallRow): typeof sandboxToolCalls.$inferInsert {
  return { ...row, startedAt: row.startedAt.getTime() };
}

function toModelRow(row: typeof sandboxModelCalls.$inferSelect): ModelCallRow {
  return { ...row, startedAt: new Date(row.startedAt) };
}

function toToolRow(row: typeof sandboxToolCalls.$inferSelect): ToolCallRow {
  return { ...row, startedAt: new Date(row.startedAt) };
}

function toBlobRow(row: typeof sandboxBlobs.$inferSelect): BlobRow {
  return { hash: row.hash, data: new Uint8Array(row.data), bytes: row.bytes, truncated: row.truncated };
}
