import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT_FORMAT_VERSION } from "@ykurilov/agent-chat-core";
import { describeChatStorageContract } from "@ykurilov/agent-chat-core/storage-contract";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../src/sqlite-storage";
import type { SqliteChatStorage } from "../src/sqlite-storage";

const directories: string[] = [];
const openStorages: SqliteChatStorage[] = [];

function temporaryFilePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "agent-chat-sqlite-"));
  directories.push(directory);
  return join(directory, "chat.sqlite");
}

function openTemporaryStorage(filePath = temporaryFilePath()): SqliteChatStorage {
  const storage = createSqliteChatStorage({ filePath });
  openStorages.push(storage);
  return storage;
}

afterEach(() => {
  for (const storage of openStorages.splice(0)) storage.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SQLite", () => {
  describeChatStorageContract(() => openTemporaryStorage(), { choiceMemory: "required", voiceDialog: "required", memory: "required", memoryOptimization: "required", spendingLimitState: "required", subjectChats: "required", chatData: "required", importChat: "required", afterTurnState: "required", chatClosure: "required", partsOfTypes: "required", usageByChat: "required", chatTurnLease: "required", pendingBursts: "required" });

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
    const filePath = temporaryFilePath();
    const storage = openTemporaryStorage(filePath);
    await storage.insertUsageRecord(usageRecord("r1", true));
    await storage.insertUsageRecord(usageRecord("r2"));
    const raw = new Database(filePath, { readonly: true });
    try {
      expect(raw.prepare("select id, estimated from usage_records order by id").all()).toEqual([
        { id: "r1", estimated: 1 },
        { id: "r2", estimated: 0 },
      ]);
    } finally {
      raw.close();
    }
  });

  it("данные переживают переоткрытие файла", async () => {
    const filePath = temporaryFilePath();
    const first = openTemporaryStorage(filePath);
    await first.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
    first.close();
    expect(await openTemporaryStorage(filePath).getChat("chat-1")).toMatchObject({ ownerId: "anna" });
  });

  const sameTime = "2026-01-01T00:00:00.000Z";
  const message = (id: string, parentId: string | null) => ({
    id,
    chatId: "chat-1",
    parentId,
    role: "user" as const,
    parts: [{ type: "text" as const, text: id }],
    formatVersion: CURRENT_FORMAT_VERSION,
    status: "complete" as const,
    modelId: null,
    providerId: null,
    usage: null,
    reasoningDurationsMs: {},
    error: null,
    createdAt: sameTime,
  });

  it("журнал расхода переживает переоткрытие файла и удаление чата", async () => {
    const filePath = temporaryFilePath();
    const first = openTemporaryStorage(filePath);
    await first.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
    await first.insertUsageRecord({
      id: "r1",
      ownerId: "anna",
      chatId: "chat-1",
      messageId: null,
      source: "compaction",
      modelId: "m",
      providerId: "p",
      inputTokens: 10,
      cachedInputTokens: 4,
      cacheWriteTokens: 0,
      outputTokens: 5,
      reasoningTokens: 1,
      costUsd: 0.5,
      createdAt: sameTime,
    });
    first.close();

    const second = openTemporaryStorage(filePath);
    const raw = new Database(filePath);
    raw.pragma("foreign_keys = ON");
    raw.prepare("DELETE FROM chats WHERE id = 'chat-1'").run();
    raw.close();
    expect(await second.getChat("chat-1")).toBeNull();
    expect(await second.sumUsage({ ownerId: "anna" })).toEqual([
      { modelId: "m", providerId: "p", inputTokens: 10, cachedInputTokens: 4, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 1, costUsd: 0.5 },
    ]);
  });

  it("порядок при равном времени не зависит от rowid: VACUUM и перенумерация его не ломают", async () => {
    const filePath = temporaryFilePath();
    const storage = openTemporaryStorage(filePath);
    await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
    await storage.insertMessage(message("a", null));
    await storage.insertMessage(message("b", "a"));
    await storage.insertMessage(message("c", "b"));
    storage.close();

    // Переворачиваем rowid, как это вправе сделать VACUUM у таблицы с текстовым первичным ключом.
    const raw = new Database(filePath);
    raw.exec("UPDATE messages SET rowid = rowid + 100");
    raw.exec("UPDATE messages SET rowid = 1 WHERE id = 'c'");
    raw.exec("UPDATE messages SET rowid = 3 WHERE id = 'a'");
    raw.exec("VACUUM");
    raw.close();

    const reopened = openTemporaryStorage(filePath);
    expect((await reopened.listMessages("chat-1")).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  describe("миграция существующей базы", () => {
    /** Папка с первыми `count` миграциями: так выглядела база одной из прежних версий. */
    function migrationsUpTo(count: number): string {
      const source = fileURLToPath(new URL("../drizzle", import.meta.url));
      const target = mkdtempSync(join(tmpdir(), "agent-chat-migrations-"));
      directories.push(target);
      mkdirSync(join(target, "meta"));
      const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as {
        entries: Array<{ tag: string }>;
      };
      const entries = journal.entries.slice(0, count);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(target, `${tag}.sql`));
      writeFileSync(join(target, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
      return target;
    }
    const firstMigrationOnly = () => migrationsUpTo(1);

    it("база до закрытого чата: прежние чаты открыты, закрытие пишется и видно в списке", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(16) });
      old.prepare("INSERT INTO chats (id, owner_id, model_id, provider_id, created_at, updated_at) VALUES ('chat-1','anna','m','p',?,?)").run(sameTime, sameTime);
      old.close();

      const storage = openTemporaryStorage(filePath);
      expect((await storage.getChat("chat-1"))?.closed).toBeUndefined();
      const closure = { code: "form_completed", message: "Заявка отправлена." };
      await storage.setChatClosed?.("chat-1", closure);
      expect((await storage.getChat("chat-1"))?.closed).toEqual(closure);
      expect((await storage.listChats("anna"))[0]?.closed).toEqual(closure);
      storage.close();
    });

    it("старые сообщения получают порядок записи, данные не теряются, новые идут следом", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: firstMigrationOnly() });
      old.prepare("INSERT INTO chats VALUES ('chat-1','anna','m','p',?,?)").run(sameTime, sameTime);
      const insert = old.prepare(
        "INSERT INTO messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at) VALUES (?, 'chat-1', ?, 'user', ?, ?, 'complete', '{}', ?)",
      );
      insert.run("a", null, JSON.stringify([{ type: "text", text: "a" }]), CURRENT_FORMAT_VERSION, sameTime);
      insert.run("b", "a", JSON.stringify([{ type: "text", text: "b" }]), CURRENT_FORMAT_VERSION, sameTime);
      insert.run("c", "b", JSON.stringify([{ type: "text", text: "c" }]), CURRENT_FORMAT_VERSION, sameTime);
      old.close();

      const storage = openTemporaryStorage(filePath);
      await storage.insertMessage(message("d", "c"));
      const items = await storage.listMessages("chat-1");
      expect(items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
      expect(items[0]).toMatchObject({ parts: [{ type: "text", text: "a" }], parentId: null, status: "complete" });
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna" });
    });

    it("база версии 0.5.0 (без сжатий) открывается: данные на месте, записи сжатия работают", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(3) });
      old.prepare("INSERT INTO chats (id, owner_id, model_id, provider_id, created_at, updated_at) VALUES ('chat-1','anna','m','p',?,?)").run(sameTime, sameTime);
      old.prepare(
        "INSERT INTO messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at, seq) VALUES ('a', 'chat-1', NULL, 'user', ?, ?, 'complete', '{}', ?, 1)",
      ).run(JSON.stringify([{ type: "text", text: "a" }]), CURRENT_FORMAT_VERSION, sameTime);
      old.close();

      const storage = openTemporaryStorage(filePath);
      expect(await storage.listMessages("chat-1")).toHaveLength(1);
      expect(await storage.listCompactions("chat-1")).toEqual([]);
      await storage.insertCompaction({
        id: "c1",
        chatId: "chat-1",
        fromMessageId: "a",
        throughMessageId: "a",
        summary: "сводка",
        summaryTokens: 5,
        modelId: "m",
        providerId: "p",
        usage: null,
        createdAt: sameTime,
      });
      expect((await storage.listCompactions("chat-1")).map((record) => record.id)).toEqual(["c1"]);
    });

    it("база версии 0.6.0 (без названий): старые чаты получают название из первого сообщения собеседника", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(5) });
      const insertChat = old.prepare(
        "INSERT INTO chats (id, owner_id, model_id, provider_id, created_at, updated_at) VALUES (?, 'anna', 'm', 'p', ?, ?)",
      );
      for (const id of ["short", "long", "files-first", "empty", "assistant-only"]) insertChat.run(id, sameTime, sameTime);
      const insertMessage = old.prepare(
        "INSERT INTO messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at, seq) VALUES (?, ?, NULL, ?, ?, ?, 'complete', '{}', ?, ?)",
      );
      const text = (value: string) => JSON.stringify([{ type: "text", text: value }]);
      let seq = 0;
      const add = (id: string, chatId: string, role: string, parts: string, createdAt = sameTime) =>
        insertMessage.run(id, chatId, role, parts, CURRENT_FORMAT_VERSION, createdAt, ++seq);
      add("m1", "short", "user", text("  Расскажи\n\nпро   Грецию "));
      add("m2", "short", "user", text("Позднее сообщение"), "2026-01-02T00:00:00.000Z");
      add("m3", "long", "user", text("а".repeat(59) + " " + "б".repeat(30)));
      add(
        "m4",
        "files-first",
        "user",
        JSON.stringify([
          { type: "file", url: "attachment:x", mediaType: "image/png" },
          { type: "text", text: "Что на картинке?" },
        ]),
      );
      add("m5", "empty", "user", text("   "));
      add("m6", "assistant-only", "assistant", text("Ответ без вопроса"));
      old.close();

      const storage = openTemporaryStorage(filePath);
      const titleOf = async (id: string) => (await storage.getChat(id))?.title;
      expect(await titleOf("short")).toBe("Расскажи про Грецию");
      expect(await titleOf("long")).toBe("а".repeat(59) + "…");
      expect(await titleOf("files-first")).toBe("Что на картинке?");
      expect(await titleOf("empty")).toBeUndefined();
      expect(await titleOf("assistant-only")).toBeUndefined();
      // Порядок списка после миграции прежний: по последней активности.
      expect((await storage.listChats("anna")).map((chat) => chat.id)).toHaveLength(5);
    });

    it("база без журнала расхода открывается: данные на месте, журнал создан пустым и работает", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(6) });
      old.prepare("INSERT INTO chats (id, owner_id, model_id, provider_id, created_at, updated_at) VALUES ('chat-1','anna','m','p',?,?)").run(sameTime, sameTime);
      old.prepare(
        "INSERT INTO messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at, seq) VALUES ('a', 'chat-1', NULL, 'user', ?, ?, 'complete', '{}', ?, 1)",
      ).run(JSON.stringify([{ type: "text", text: "a" }]), CURRENT_FORMAT_VERSION, sameTime);
      old.close();

      const storage = openTemporaryStorage(filePath);
      expect(await storage.listMessages("chat-1")).toHaveLength(1);
      expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);
      await storage.insertUsageRecord({
        id: "r1",
        ownerId: "anna",
        chatId: "chat-1",
        messageId: "a",
        source: "answer",
        modelId: "m",
        providerId: "p",
        inputTokens: 3,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 2,
        reasoningTokens: 0,
        costUsd: 0.5,
        createdAt: sameTime,
      });
      expect((await storage.sumUsage({ ownerId: "anna" }))[0]).toMatchObject({ inputTokens: 3, outputTokens: 2 });
    });

    it("база без запомненного выбора модели открывается: данные на месте, выбор запоминается и переживает переоткрытие", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(7) });
      old.prepare("INSERT INTO chats (id, owner_id, model_id, provider_id, reasoning, created_at, updated_at) VALUES ('chat-1','anna','m','p','high',?,?)").run(sameTime, sameTime);
      old.close();

      const storage = openTemporaryStorage(filePath);
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna", modelId: "m", reasoning: "high" });
      expect(await storage.getUserModelChoice?.("anna")).toBeNull();
      await storage.saveUserModelChoice?.("anna", { modelId: "m2", providerId: "p2", reasoning: "low" });
      storage.close();

      const reopened = openTemporaryStorage(filePath);
      expect(await reopened.getUserModelChoice?.("anna")).toEqual({ modelId: "m2", providerId: "p2", reasoning: "low" });
      expect(await reopened.getChat("chat-1")).toMatchObject({ modelId: "m", providerId: "p", reasoning: "high" });
    });

    it("база без голосового режима открывается: старые сообщения читаются с voiceCut: null, отметка и выбор голоса переживают переоткрытие", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(8) });
      old.prepare("INSERT INTO chats (id, owner_id, model_id, provider_id, created_at, updated_at) VALUES ('chat-1','anna','m','p',?,?)").run(sameTime, sameTime);
      old.prepare(
        "INSERT INTO messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at, seq) VALUES ('a', 'chat-1', NULL, 'assistant', ?, ?, 'complete', '{}', ?, 1)",
      ).run(JSON.stringify([{ type: "text", text: "ответ" }]), CURRENT_FORMAT_VERSION, sameTime);
      old.close();

      const storage = openTemporaryStorage(filePath);
      expect((await storage.getMessage("a"))?.voiceCut).toBeNull();
      expect((await storage.listMessages("chat-1"))[0]?.voiceCut).toBeNull();
      expect(await storage.getVoiceChoice?.("anna")).toBeNull();
      const cut = { partIndex: 0, charOffset: 3, spokenTail: "отв" };
      await storage.setVoiceCut?.({ ownerId: "anna", chatId: "chat-1", messageId: "a", voiceCut: cut });
      await storage.setVoiceChoice?.("anna", "voice-a");
      storage.close();

      const reopened = openTemporaryStorage(filePath);
      expect((await reopened.getMessage("a"))?.voiceCut).toEqual(cut);
      expect(await reopened.getVoiceChoice?.("anna")).toBe("voice-a");
    });

    it("база без долгой памяти открывается: данные на месте, таблица памяти пуста, записи переживают переоткрытие", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(7) });
      old.prepare("INSERT INTO chats (id, owner_id, model_id, provider_id, reasoning, created_at, updated_at) VALUES ('chat-1','anna','m','p','high',?,?)").run(sameTime, sameTime);
      old.close();

      const storage = openTemporaryStorage(filePath);
      expect(await storage.getChat("chat-1")).toMatchObject({ ownerId: "anna", modelId: "m", reasoning: "high" });
      expect(await storage.listMemoryNotes?.("anna")).toEqual([]);
      const [created] = (await storage.insertMemoryNotes?.("anna", [{ categories: ["О себе", "Работа"], content: "Пишет на TypeScript" }])) ?? [];
      storage.close();

      const reopened = openTemporaryStorage(filePath);
      expect(await reopened.listMemoryNotes?.("anna")).toEqual([created]);
      expect(await reopened.getChat("chat-1")).toMatchObject({ ownerId: "anna", modelId: "m", reasoning: "high" });
    });

    it("база с памятью, но без оптимизации дублей открывается: записи на месте и видны, слияние работает и переживает переоткрытие", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(10) });
      const insert = old.prepare("INSERT INTO memory_notes (id, owner_id, categories, content, version, created_at, updated_at) VALUES (?, 'anna', ?, ?, 1, 1000, 1000)");
      insert.run("n1", JSON.stringify(["О себе"]), "Пишет на TypeScript");
      insert.run("n2", JSON.stringify(["О себе"]), "Работает с TypeScript");
      old.close();

      const storage = openTemporaryStorage(filePath);
      expect((await storage.listMemoryNotes?.("anna"))?.map((note) => note.id).sort()).toEqual(["n1", "n2"]);
      const rules = { minIntervalMs: 86_400_000, retryAfterFailureMs: 3_600_000, leaseMs: 180_000 };
      const run = await storage.claimMemoryOptimizationRun?.("anna", rules, sameTime);
      const merged = await storage.applyMemoryMerge?.("anna", {
        runId: run!.id,
        finishedAt: sameTime,
        merges: [{ result: { categories: ["О себе"], content: "Пишет на TypeScript на работе" }, originals: [{ id: "n1", version: 1 }, { id: "n2", version: 1 }] }],
      });
      expect(merged).toMatchObject({ status: "applied" });
      storage.close();

      const reopened = openTemporaryStorage(filePath);
      expect((await reopened.listMemoryNotes?.("anna"))?.map((note) => note.content)).toEqual(["Пишет на TypeScript на работе"]);
      expect((await reopened.listMergedMemoryNotes?.("anna"))?.map((note) => note.id).sort()).toEqual(["n1", "n2"]);
      expect(await reopened.revertMemoryMerge?.("anna", run!.id)).toBe("ok");
      expect((await reopened.listMemoryNotes?.("anna"))?.map((note) => note.id).sort()).toEqual(["n1", "n2"]);
    });

    it("база версии 0.6.0 (без выбора веток) открывается: данные на месте, выбор ветки работает", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsUpTo(4) });
      old.prepare("INSERT INTO chats (id, owner_id, model_id, provider_id, created_at, updated_at) VALUES ('chat-1','anna','m','p',?,?)").run(sameTime, sameTime);
      old.prepare(
        "INSERT INTO messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at, seq) VALUES ('a', 'chat-1', NULL, 'user', ?, ?, 'complete', '{}', ?, 1)",
      ).run(JSON.stringify([{ type: "text", text: "a" }]), CURRENT_FORMAT_VERSION, sameTime);
      old.close();

      const storage = openTemporaryStorage(filePath);
      expect(await storage.listMessages("chat-1")).toHaveLength(1);
      expect(await storage.listBranchSelections("chat-1")).toEqual([]);
      await storage.insertBranchSelection({ id: "s1", chatId: "chat-1", messageId: "a", selectedAt: sameTime });
      expect(await storage.listBranchSelections("chat-1")).toEqual([
        { id: "s1", chatId: "chat-1", messageId: "a", selectedAt: sameTime },
      ]);
    });
  });
});
