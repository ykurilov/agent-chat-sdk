import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describeChatStorageContract } from "@ykurilov/agent-chat-core/storage-contract";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "@ykurilov/agent-chat-core";
import { createPostgresChatStorage } from "../src/postgres-storage";
import type { PostgresChatStorage } from "../src/postgres-storage";
import { createDrizzleChatStorage, storageSchema } from "../src/drizzle-chat-storage";
import { createPgliteChatStorage } from "./support/pglite-database";
import type { PgliteChatStorage } from "./support/pglite-database";
import { assertSafeToWipe } from "./support/wipe-guard";
import { startTemporaryPostgres } from "./support/pglite-server";
import type { TemporaryPostgres } from "./support/pglite-server";

const databases: TemporaryPostgres[] = [];
const openStorages: Array<PostgresChatStorage | PgliteChatStorage> = [];

async function freshDatabase(): Promise<TemporaryPostgres> {
  const database = await startTemporaryPostgres();
  databases.push(database);
  return database;
}

async function openStorage(connectionString: string): Promise<PostgresChatStorage> {
  const storage = await createPostgresChatStorage({ connectionString, poolSize: 1, logError: () => {} });
  openStorages.push(storage);
  return storage;
}

/** Прямой запрос к базе: проверить, где лежат таблицы. */
async function query(connectionString: string, text: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
}

afterEach(async () => {
  for (const storage of openStorages.splice(0)) await storage.close().catch(() => {});
  for (const database of databases.splice(0)) await database.stop();
});

describe("PostgreSQL: запросы и миграции на встроенной базе pglite", () => {
  describeChatStorageContract(async () => {
    const storage = await createPgliteChatStorage();
    openStorages.push(storage);
    return storage;
  }, { choiceMemory: "required", voiceDialog: "required", memory: "required", memoryOptimization: "required", spendingLimitState: "required", subjectChats: "required", chatData: "required", importChat: "required", afterTurnState: "required", chatClosure: "required", partsOfTypes: "required", usageByChat: "required", chatTurnLease: "required", pendingBursts: "required" });
});

/** Сообщение чата c1 с обычными значениями полей. */
function message(fields: Pick<StoredMessage, "id" | "role" | "createdAt"> & Partial<StoredMessage>): StoredMessage {
  return { chatId: "c1", parentId: null, formatVersion: 1, status: "complete", parts: [], modelId: null, providerId: null, usage: null, reasoningDurationsMs: {}, error: null, ...fields };
}

describe("PostgreSQL: знак жизни идущего ответа по часам базы (FR-060)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("знак «сейчас» и граница молчания считаются по часам базы: время машины сервера в запросы не идёт", async () => {
    const queries: Array<{ query: string; params: unknown[] }> = [];
    const storage = await createPgliteChatStorage({ onQuery: (query, params) => queries.push({ query, params }) });
    openStorages.push(storage);
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: "m", providerId: "p" });
    await storage.insertMessage(message({ id: "u1", role: "user", createdAt: "1999-01-01T00:00:00.000Z" }));
    // Часы машины сервера — своё, заметное время: его не должно быть ни в одном запросе про знак жизни.
    vi.useFakeTimers({ now: Date.parse("2011-11-11T11:11:11.000Z"), toFake: ["Date"] });
    queries.length = 0;
    await storage.insertMessage(message({ id: "a1", parentId: "u1", role: "assistant", status: "streaming", createdAt: "1999-01-01T00:00:01.000Z", alive: "now" }));
    await storage.updateStreamingMessage("a1", { parts: [], alive: "now" });
    await storage.markAnswerAlive!("a1");
    await storage.listSilentAnswerIds!({ silentForMs: 60_000, chatId: "c1" });

    const aboutAlive = queries.filter(({ query }) => query.includes("alive_at"));
    expect(aboutAlive.length).toBeGreaterThanOrEqual(4);
    for (const { query, params } of aboutAlive) {
      expect(query).toContain("now()");
      expect(params.some((param) => String(param).startsWith("2011-11-11"))).toBe(false);
    }
  });
});

describe("PostgreSQL: updateChatData блокирует строку чата на время слияния", () => {
  // Встроенная база принимает одно соединение, настоящей гонки на ней не получить: проверяется сам запрос. Блокировка
  // `for update` перед записью — то, что ставит параллельные правки одного чата в очередь (начало и конец транзакции
  // драйвер в журнал запросов не пишет).
  it("чтение данных идёт с `for update`, и только после него — запись данных", async () => {
    const queries: string[] = [];
    const storage = await createPgliteChatStorage({ onQuery: (query) => queries.push(query.toLowerCase()) });
    openStorages.push(storage);
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: "m", providerId: "p", data: { a: 1 } });
    queries.length = 0;
    await storage.updateChatData!("c1", { b: 2 }, { maxBytes: 16 * 1024 });

    const locked = queries.findIndex((query) => query.startsWith("select") && query.includes('"chats"') && query.endsWith("for update"));
    const written = queries.findIndex((query) => query.startsWith("update") && query.includes('"chats"') && query.includes('"subject_data"'));
    expect(locked).toBe(0);
    expect(written).toBe(1);
    expect(queries).toHaveLength(2);
  });
});

/*
 * Драйвер `pg`, пул и миграции — на pglite за сетевым протоколом. Только штатные сценарии: после ошибки
 * запроса сервер сокета pglite иногда путает ответы (проверено голыми запросами `pg`, без этого кода), поэтому
 * сценарии с ошибками базы идут на встроенной базе выше и на настоящем PostgreSQL ниже.
 */
describe("PostgreSQL: драйвер pg и пул на pglite за сокетом", () => {
  it("создаёт и читает чат и сообщение через пул", async () => {
    const storage = await openStorage((await freshDatabase()).connectionString);
    await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
    expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna", modelId: "m" });
    expect(await storage.listMessages("chat-1")).toEqual([]);
  });

  it("данные переживают закрытие и повторное открытие", async () => {
    const { connectionString } = await freshDatabase();
    const first = await openStorage(connectionString);
    await first.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
    await first.close();
    expect(await (await openStorage(connectionString)).getChat("chat-1")).toMatchObject({ ownerId: "anna" });
  });

  const usageRecord = (id: string, estimated?: boolean) => ({
    id,
    ownerId: "anna",
    chatId: "chat-1",
    messageId: null,
    source: "answer" as const,
    modelId: "m",
    providerId: "p",
    inputTokens: 10,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
    reasoningTokens: 0,
    costUsd: 0,
    createdAt: "2099-01-01T00:00:00.000Z",
    ...(estimated !== undefined && { estimated }),
  });

  it("пометка «примерно» у записи расхода лежит в своей колонке; без пометки — false", async () => {
    const { connectionString } = await freshDatabase();
    const storage = await openStorage(connectionString);
    await storage.insertUsageRecord(usageRecord("r1", true));
    await storage.insertUsageRecord(usageRecord("r2"));
    await storage.close(); // pglite принимает одно соединение: сначала закрыть хранилище
    expect(await query(connectionString, "select id, estimated from agent_chat.usage_records order by id")).toEqual([
      { id: "r1", estimated: true },
      { id: "r2", estimated: false },
    ]);
  });

  it("повторное создание на базе с применёнными миграциями ничего не меняет", async () => {
    const { connectionString } = await freshDatabase();
    await (await openStorage(connectionString)).close();
    const before = await query(connectionString, "select id, hash from agent_chat.__drizzle_migrations order by id");
    await (await openStorage(connectionString)).close();
    expect(await query(connectionString, "select id, hash from agent_chat.__drizzle_migrations order by id")).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it("таблицы лежат только в схеме agent_chat, чужие chats и messages не тронуты", async () => {
    const { connectionString } = await freshDatabase();
    await query(connectionString, "create table public.chats (own_column text)");
    await query(connectionString, "create table public.messages (own_column text)");
    await query(connectionString, "insert into public.chats values ('чужое')");
    await (await openStorage(connectionString)).close(); // pglite принимает одно соединение: сначала закрыть хранилище
    const tables = await query(
      connectionString,
      "select table_schema, table_name from information_schema.tables where table_name in ('chats', 'messages') order by 1, 2",
    );
    expect(tables).toEqual([
      { table_schema: "agent_chat", table_name: "chats" },
      { table_schema: "agent_chat", table_name: "messages" },
      { table_schema: "public", table_name: "chats" },
      { table_schema: "public", table_name: "messages" },
    ]);
    expect(await query(connectionString, "select own_column from public.chats")).toEqual([{ own_column: "чужое" }]);
  });

});

describe("PostgreSQL: миграция существующей базы", () => {
  it("база версии 0.5.0 (без сжатий) переезжает на последнюю миграцию: данные на месте, записи сжатия работают", async () => {
    const source = fileURLToPath(new URL("../drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, 2);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      await database.exec("insert into agent_chat.chats (id, owner_id, model_id, provider_id, created_at, updated_at) values ('chat-1','anna','m','p','2099-01-01','2099-01-01')");

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna" });
      expect(await storage.listCompactions("chat-1")).toEqual([]);
      await storage.insertCompaction({
        id: "c1",
        chatId: "chat-1",
        fromMessageId: "a",
        throughMessageId: "b",
        summary: "сводка",
        summaryTokens: 5,
        modelId: "m",
        providerId: "p",
        usage: null,
        createdAt: "2099-01-01",
      });
      expect((await storage.listCompactions("chat-1")).map((record) => record.id)).toEqual(["c1"]);
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });

  it("база версии 0.6.0 (без выбора веток) переезжает на последнюю миграцию: данные на месте, выбор ветки работает", async () => {
    const source = fileURLToPath(new URL("../drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, 3);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      await database.exec("insert into agent_chat.chats (id, owner_id, model_id, provider_id, created_at, updated_at) values ('chat-1','anna','m','p','2099-01-01','2099-01-01')");

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna" });
      expect(await storage.listBranchSelections("chat-1")).toEqual([]);
      await storage.insertBranchSelection({ id: "s1", chatId: "chat-1", messageId: "a", selectedAt: "2099-01-01" });
      expect((await storage.listBranchSelections("chat-1")).map((record) => record.id)).toEqual(["s1"]);
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });

  it("база без журнала расхода переезжает на последнюю миграцию: данные на месте, журнал создан пустым и работает", async () => {
    const source = fileURLToPath(new URL("../drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, 5);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      await database.exec("insert into agent_chat.chats (id, owner_id, model_id, provider_id, created_at, updated_at) values ('chat-1','anna','m','p','2099-01-01','2099-01-01')");

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna" });
      expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);
      await storage.insertUsageRecord({
        id: "r1",
        ownerId: "anna",
        chatId: "chat-1",
        messageId: null,
        source: "answer",
        modelId: "m",
        providerId: "p",
        inputTokens: 3,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 2,
        reasoningTokens: 0,
        costUsd: 0.5,
        createdAt: "2099-01-01T00:00:00.000Z",
      });
      expect((await storage.sumUsage({ ownerId: "anna" }))[0]).toMatchObject({ inputTokens: 3, outputTokens: 2 });
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });
});

describe("PostgreSQL: запомненный выбор модели", () => {
  it("база без запомненного выбора переезжает на последнюю миграцию: данные на месте, выбор запоминается", async () => {
    const source = fileURLToPath(new URL("../drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, 6);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      await database.exec("insert into agent_chat.chats (id, owner_id, model_id, provider_id, reasoning, created_at, updated_at) values ('chat-1','anna','m','p','high','2099-01-01','2099-01-01')");

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna", modelId: "m", reasoning: "high" });
      expect(await storage.getUserModelChoice?.("anna")).toBeNull();
      await storage.saveUserModelChoice?.("anna", { modelId: "m2", providerId: "p2", reasoning: "low" });
      expect(await storage.getUserModelChoice?.("anna")).toEqual({ modelId: "m2", providerId: "p2", reasoning: "low" });
      expect(await storage.getChat("chat-1")).toMatchObject({ modelId: "m", providerId: "p", reasoning: "high" });
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });

  it("таблица выбора лежит в схеме agent_chat", async () => {
    const database = await PGlite.create();
    const db = drizzle(database, { schema: storageSchema });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)), migrationsSchema: "agent_chat" });
    const tables = await database.query<{ table_schema: string }>("select table_schema from information_schema.tables where table_name = 'user_model_choices'");
    expect(tables.rows.map((row) => row.table_schema)).toEqual(["agent_chat"]);
    await database.close();
  });
});

describe("PostgreSQL: голосовой режим", () => {
  it("база без голосового режима переезжает на последнюю миграцию: старые сообщения читаются с voiceCut: null, отметка и выбор голоса работают", async () => {
    const source = fileURLToPath(new URL("../drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, 7);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      await database.exec("insert into agent_chat.chats (id, owner_id, model_id, provider_id, created_at, updated_at) values ('chat-1','anna','m','p','2099-01-01','2099-01-01')");
      await database.exec(
        `insert into agent_chat.messages (id, chat_id, role, parts, format_version, status, reasoning_durations_ms, created_at) values ('a','chat-1','assistant','[{"type":"text","text":"ответ"}]',1,'complete','{}','2099-01-01')`,
      );

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      expect((await storage.getMessage("a"))?.voiceCut).toBeNull();
      expect(await storage.getVoiceChoice?.("anna")).toBeNull();
      const cut = { partIndex: 0, charOffset: 3, spokenTail: "отв" };
      await storage.setVoiceCut?.({ ownerId: "anna", chatId: "chat-1", messageId: "a", voiceCut: cut });
      await storage.setVoiceChoice?.("anna", "voice-a");
      expect((await storage.getMessage("a"))?.voiceCut).toEqual(cut);
      expect(await storage.getVoiceChoice?.("anna")).toBe("voice-a");
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });

  it("таблица выбора голоса лежит в схеме agent_chat", async () => {
    const database = await PGlite.create();
    const db = drizzle(database, { schema: storageSchema });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)), migrationsSchema: "agent_chat" });
    const tables = await database.query<{ table_schema: string }>("select table_schema from information_schema.tables where table_name = 'voice_choices'");
    expect(tables.rows.map((row) => row.table_schema)).toEqual(["agent_chat"]);
    await database.close();
  });
});

describe("PostgreSQL: долгая память", () => {
  const source = fileURLToPath(new URL("../drizzle", import.meta.url));

  it("база до долгой памяти переезжает на последнюю миграцию: данные на месте, таблица пуста и работает", async () => {
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const memoryIndex = journal.entries.findIndex((entry) => entry.tag === "0008_memory_notes");
    expect(memoryIndex).toBeGreaterThan(0);
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, memoryIndex);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      await database.exec("insert into agent_chat.chats (id, owner_id, model_id, provider_id, reasoning, created_at, updated_at) values ('chat-1','anna','m','p','high','2099-01-01','2099-01-01')");

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna", modelId: "m", reasoning: "high" });
      expect(await storage.listMemoryNotes?.("anna")).toEqual([]);
      const [created] = (await storage.insertMemoryNotes?.("anna", [{ categories: ["О себе", "Работа"], content: "Пишет на TypeScript" }])) ?? [];
      expect(created).toMatchObject({ version: 1, categories: ["О себе", "Работа"], content: "Пишет на TypeScript" });
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna" });
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });

  it("таблица памяти лежит в схеме agent_chat: разделы — jsonb, время — timestamptz, индекс по человеку и времени правки", async () => {
    const database = await PGlite.create();
    const db = drizzle(database, { schema: storageSchema });
    await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
    const tables = await database.query<{ table_schema: string }>("select table_schema from information_schema.tables where table_name = 'memory_notes'");
    expect(tables.rows.map((row) => row.table_schema)).toEqual(["agent_chat"]);
    const columns = await database.query<{ column_name: string; data_type: string; is_nullable: string }>(
      "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'agent_chat' and table_name = 'memory_notes' order by column_name",
    );
    expect(columns.rows).toEqual([
      { column_name: "categories", data_type: "jsonb", is_nullable: "NO" },
      { column_name: "content", data_type: "text", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "id", data_type: "text", is_nullable: "NO" },
      { column_name: "merged_into", data_type: "text", is_nullable: "YES" },
      { column_name: "owner_id", data_type: "text", is_nullable: "NO" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "version", data_type: "integer", is_nullable: "NO" },
    ]);
    const indexes = await database.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'agent_chat' and tablename = 'memory_notes' and indexname = 'memory_notes_owner_updated_idx'",
    );
    expect(indexes.rows[0]?.indexdef).toContain("(owner_id, updated_at)");
    await database.close();
  });

  it("время записи — ISO 8601 с миллисекундами в UTC; внешнего ключа на чаты нет", async () => {
    const database = await PGlite.create();
    const db = drizzle(database, { schema: storageSchema });
    await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
    const storage = createDrizzleChatStorage(db);
    const [created] = (await storage.insertMemoryNotes?.("anna", [{ categories: ["О себе"], content: "Запись" }])) ?? [];
    expect(created?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const constraints = await database.query("select 1 from information_schema.table_constraints where table_schema = 'agent_chat' and table_name = 'memory_notes' and constraint_type = 'FOREIGN KEY'");
    expect(constraints.rows).toEqual([]);
    await database.close();
  });
});

describe("PostgreSQL: закрытый чат на старой базе", () => {
  const source = fileURLToPath(new URL("../drizzle", import.meta.url));

  it("база до закрытого чата переезжает на последнюю миграцию: прежние чаты открыты, закрытие пишется", async () => {
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const closedIndex = journal.entries.findIndex((entry) => entry.tag === "0015_chat_closed");
    expect(closedIndex).toBeGreaterThan(0);
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, closedIndex);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      await database.exec(
        "insert into agent_chat.chats (id, owner_id, model_id, provider_id, created_at, updated_at) values ('chat-1','anna','m','p','2099-01-01','2099-01-01')",
      );

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      expect((await storage.getChat("chat-1"))?.closed).toBeUndefined();
      const closure = { code: "form_completed", message: "Заявка отправлена." };
      await storage.setChatClosed?.("chat-1", closure);
      expect((await storage.getChat("chat-1"))?.closed).toEqual(closure);
      expect((await storage.listChats("anna"))[0]?.closed).toEqual(closure);
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });
});

describe("PostgreSQL: оптимизация дублей", () => {
  const source = fileURLToPath(new URL("../drizzle", import.meta.url));

  it("база с памятью, но без оптимизации дублей переезжает на последнюю миграцию: записи видны, запуски работают", async () => {
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const optimizationIndex = journal.entries.findIndex((entry) => entry.tag === "0009_memory_optimization");
    expect(optimizationIndex).toBeGreaterThan(0);
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, optimizationIndex);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      await database.exec(
        "insert into agent_chat.memory_notes (id, owner_id, categories, content, version, created_at, updated_at) values ('n1','anna','[\"О себе\"]','Пишет на TypeScript',1,'2099-01-01','2099-01-01')",
      );

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      expect(await storage.listMemoryNotes?.("anna")).toMatchObject([{ id: "n1", content: "Пишет на TypeScript", version: 1 }]);
      expect(await storage.listMergedMemoryNotes?.("anna")).toEqual([]);
      const run = await storage.claimMemoryOptimizationRun?.("anna", { minIntervalMs: 3_600_000, retryAfterFailureMs: 60_000, leaseMs: 180_000 }, "2099-01-02T00:00:00.000Z");
      expect(run).toMatchObject({ status: "running", groups: [] });
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });

  it("таблица запусков лежит в схеме agent_chat: время — timestamptz, состав слияний — jsonb, один запуск в работе на человека", async () => {
    const database = await PGlite.create();
    const db = drizzle(database, { schema: storageSchema });
    await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
    const columns = await database.query<{ column_name: string; data_type: string; is_nullable: string }>(
      "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'agent_chat' and table_name = 'memory_optimization_runs' order by column_name",
    );
    expect(columns.rows).toEqual([
      { column_name: "error", data_type: "text", is_nullable: "YES" },
      { column_name: "finished_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "groups", data_type: "jsonb", is_nullable: "NO" },
      { column_name: "id", data_type: "text", is_nullable: "NO" },
      { column_name: "owner_id", data_type: "text", is_nullable: "NO" },
      { column_name: "started_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "status", data_type: "text", is_nullable: "NO" },
      { column_name: "usage_record_id", data_type: "text", is_nullable: "YES" },
    ]);
    const indexes = await database.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'agent_chat' and indexname = 'memory_optimization_runs_one_running_idx'",
    );
    expect(indexes.rows[0]?.indexdef).toMatch(/UNIQUE.*\(owner_id\).*running/i);
    await database.close();
  });
});

describe("PostgreSQL: журнал расхода", () => {
  it("переживает удаление чата, суммы точны", async () => {
    const database = await PGlite.create();
    const db = drizzle(database, { schema: storageSchema });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)), migrationsSchema: "agent_chat" });
    const storage = createDrizzleChatStorage(db);
    await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
    await storage.insertUsageRecord({
      id: "r1",
      ownerId: "anna",
      chatId: "chat-1",
      messageId: null,
      source: "compaction",
      modelId: "m",
      providerId: "p",
      inputTokens: 3_000_000_000,
      cachedInputTokens: 4,
      cacheWriteTokens: 0,
      outputTokens: 5,
      reasoningTokens: 1,
      costUsd: 0.5,
      createdAt: "2099-01-01T00:00:00.000Z",
    });
    await database.exec("delete from agent_chat.chats where id = 'chat-1'");
    expect(await storage.getChat("chat-1")).toBeNull();
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([
      { modelId: "m", providerId: "p", inputTokens: 3_000_000_000, cachedInputTokens: 4, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 1, costUsd: 0.5 },
    ]);
    await database.close();
  });
});

describe("PostgreSQL: миграция названий чатов", () => {
  it("база версии 0.6.0 (без названий): старые чаты получают название из первого сообщения собеседника", async () => {
    const source = fileURLToPath(new URL("../drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const previous = mkdtempSync(join(tmpdir(), "agent-chat-pg-migrations-"));
    try {
      mkdirSync(join(previous, "meta"));
      const entries = journal.entries.slice(0, 3);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(previous, `${tag}.sql`));
      writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

      const database = await PGlite.create();
      const db = drizzle(database, { schema: storageSchema });
      await migrate(db, { migrationsFolder: previous, migrationsSchema: "agent_chat" });
      for (const id of ["short", "long", "files-first", "empty", "assistant-only"]) {
        await database.query(
          "insert into agent_chat.chats (id, owner_id, model_id, provider_id, created_at, updated_at) values ($1,'anna','m','p','2026-01-01','2026-01-01')",
          [id],
        );
      }
      const text = (value: string) => JSON.stringify([{ type: "text", text: value }]);
      const add = (id: string, chatId: string, role: string, parts: string, createdAt = "2026-01-01") =>
        database.query(
          "insert into agent_chat.messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at) values ($1,$2,null,$3,$4,1,'complete','{}',$5)",
          [id, chatId, role, parts, createdAt],
        );
      await add("m1", "short", "user", text("  Расскажи\n\nпро   Грецию "));
      await add("m2", "short", "user", text("Позднее сообщение"), "2026-01-02");
      await add("m3", "long", "user", text("а".repeat(59) + " " + "б".repeat(30)));
      await add(
        "m4",
        "files-first",
        "user",
        JSON.stringify([
          { type: "file", url: "attachment:x", mediaType: "image/png" },
          { type: "text", text: "Что на картинке?" },
        ]),
      );
      await add("m5", "empty", "user", text("   "));
      await add("m6", "assistant-only", "assistant", text("Ответ без вопроса"));

      await migrate(db, { migrationsFolder: source, migrationsSchema: "agent_chat" });
      const storage = createDrizzleChatStorage(db);
      const titleOf = async (id: string) => (await storage.getChat(id))?.title;
      expect(await titleOf("short")).toBe("Расскажи про Грецию");
      expect(await titleOf("long")).toBe("а".repeat(59) + "…");
      expect(await titleOf("files-first")).toBe("Что на картинке?");
      expect(await titleOf("empty")).toBeUndefined();
      expect(await titleOf("assistant-only")).toBeUndefined();
      await database.close();
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
  });
});

describe("PostgreSQL: ошибка подключения", () => {
  it("недоступная база — понятная ошибка без пароля", async () => {
    const database = await startTemporaryPostgres();
    await database.stop();
    const address = database.connectionString.replace("postgres://postgres@", "postgres://anna:секрет-пароль@");
    const failure = await createPostgresChatStorage({ connectionString: address, poolSize: 1 }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("Не удалось подключиться к PostgreSQL");
    expect((failure as Error).message).toContain("127.0.0.1");
    expect((failure as Error).message).not.toContain("секрет-пароль");
  });

  it("строка подключения, которую не разобрать, — ошибка без её текста", async () => {
    const failure = await createPostgresChatStorage({ connectionString: "не-адрес-с-паролем:hunter2@" }).catch(
      (error: Error) => error,
    );
    expect((failure as Error).message).toContain("Не удалось подключиться к PostgreSQL");
    expect((failure as Error).message).not.toContain("hunter2");
  });
});

/**
 * Настоящий PostgreSQL: pglite принимает одно соединение, а блокировку миграций и одновременные записи
 * можно проверить только на нескольких. Включается переменной, например
 * `AGENT_CHAT_TEST_POSTGRES_URL=postgres://localhost:5432/agent_chat_test`. Схема `agent_chat` в этой базе стирается,
 * поэтому имя базы должно содержать `test` (см. `support/wipe-guard.ts`).
 */
const realPostgresUrl = process.env.AGENT_CHAT_TEST_POSTGRES_URL;

describe.skipIf(!realPostgresUrl)("PostgreSQL (настоящий сервер)", () => {
  // Дальше схема agent_chat в этой базе стирается: чужую базу не трогаем.
  if (realPostgresUrl) assertSafeToWipe(realPostgresUrl);

  async function cleanSchema(): Promise<void> {
    await query(realPostgresUrl!, "drop schema if exists agent_chat cascade");
  }

  afterEach(cleanSchema);

  describeChatStorageContract(async () => {
    await cleanSchema();
    return openStorageWithPool(realPostgresUrl!, 10);
  }, { choiceMemory: "required", memory: "required", memoryOptimization: "required", spendingLimitState: "required", subjectChats: "required", chatData: "required", importChat: "required", afterTurnState: "required", chatClosure: "required", partsOfTypes: "required", usageByChat: "required", chatTurnLease: "required", pendingBursts: "required" });

  it("два хранилища стартуют одновременно на пустой схеме (20 повторов)", async () => {
    for (let round = 0; round < 20; round++) {
      await cleanSchema();
      const storages = await Promise.all([1, 2, 3].map(() => openStorageWithPool(realPostgresUrl!, 4)));
      const id = `chat-${randomUUID()}`;
      await storages[0]!.createChat({ id, ownerId: "anna", modelId: "m", providerId: "p" });
      expect(await storages[1]!.getChat(id)).toMatchObject({ ownerId: "anna" });
      for (const storage of storages) await storage.close();
      openStorages.length = 0;
    }
  }, 120_000);

  it("одновременные записи в разные ответы не мешают друг другу", async () => {
    await cleanSchema();
    const storage = await openStorageWithPool(realPostgresUrl!, 10);
    await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
    const base = { chatId: "chat-1", parentId: null, role: "assistant" as const, formatVersion: 1, status: "streaming" as const };
    const answers = Array.from({ length: 20 }, (_, index) => ({
      ...base,
      id: `a${index}`,
      parts: [],
      modelId: null,
      providerId: null,
      usage: null,
      reasoningDurationsMs: {},
      error: null,
      createdAt: `2099-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    await Promise.all(answers.map((answer) => storage.insertMessage(answer)));
    await Promise.all(
      answers.map((answer) => storage.updateStreamingMessage(answer.id, { parts: [{ type: "text", text: answer.id }] })),
    );
    const saved = await storage.listMessages("chat-1");
    expect(saved.map((message) => message.parts)).toEqual(answers.map((answer) => [{ type: "text", text: answer.id }]));
  });
});

async function openStorageWithPool(connectionString: string, poolSize: number): Promise<PostgresChatStorage> {
  const storage = await createPostgresChatStorage({ connectionString, poolSize, logError: () => {} });
  openStorages.push(storage);
  return storage;
}
