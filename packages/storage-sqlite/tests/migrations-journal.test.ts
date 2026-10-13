import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../src/sqlite-storage";

const directories: string[] = [];
const sdkMigrations = fileURLToPath(new URL("../drizzle", import.meta.url));
const sdkEntries = (JSON.parse(readFileSync(join(sdkMigrations, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string; when: number }> }).entries;
/** Миграция приложения, сделанная позже всех миграций SDK. */
const appMigrationMillis = sdkEntries.at(-1)!.when + 1000;

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryFilePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "agent-chat-journal-"));
  directories.push(directory);
  return join(directory, "chat.sqlite");
}

/** Папка с миграциями SDK до `lastTag` включительно. */
function migrationsThrough(lastTag: string): string {
  return migrationsWhere((tags) => tags.slice(0, tags.indexOf(lastTag) + 1));
}

/** Папка с миграциями SDK без одной: так её пропускал общий журнал. */
function migrationsWithout(skippedTag: string): string {
  return migrationsWhere((tags) => tags.filter((tag) => tag !== skippedTag));
}

function migrationsWhere(pick: (tags: string[]) => string[]): string {
  const target = mkdtempSync(join(tmpdir(), "agent-chat-old-migrations-"));
  directories.push(target);
  mkdirSync(join(target, "meta"));
  const journal = JSON.parse(readFileSync(join(sdkMigrations, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
  const kept = new Set(pick(journal.entries.map(({ tag }) => tag)));
  const entries = journal.entries.filter(({ tag }) => kept.has(tag));
  for (const { tag } of entries) cpSync(join(sdkMigrations, `${tag}.sql`), join(target, `${tag}.sql`));
  writeFileSync(join(target, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  return target;
}

/** Так SDK 0.31.2 и раньше вёл журнал: общая таблица drizzle `__drizzle_migrations`. */
function oldSdkFile(migrationsFolder = sdkMigrations): string {
  const filePath = temporaryFilePath();
  const old = new Database(filePath);
  migrate(drizzle(old), { migrationsFolder });
  const now = "2026-01-01T00:00:00.000Z";
  old.prepare("insert into chats (id, owner_id, model_id, provider_id, created_at, updated_at) values ('c1','anna','m','p',?,?)").run(now, now);
  old.prepare(
    "insert into messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at, seq) values ('m1','c1',null,'user',?,1,'complete','{}',?,1)",
  ).run(JSON.stringify([{ type: "text", text: "Привет" }]), now);
  old.close();
  return filePath;
}

/** Приложение ведёт в том же файле свою миграцию drizzle: запись в общем журнале новее миграций SDK. */
function addAppMigration(filePath: string, createdAt = appMigrationMillis): void {
  const raw = new Database(filePath);
  raw.exec("create table if not exists __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
  raw.exec("create table forms (id text primary key, title text)");
  raw.prepare("insert into __drizzle_migrations (hash, created_at) values ('миграция-приложения', ?)").run(createdAt);
  raw.close();
}

function read<T>(filePath: string, query: string): T[] {
  const raw = new Database(filePath, { readonly: true });
  try {
    return raw.prepare(query).all() as T[];
  } finally {
    raw.close();
  }
}

describe("свой журнал миграций SDK в SQLite", () => {
  it("новый файл: журнал SDK в __agent_chat_migrations, общий __drizzle_migrations не создаётся", () => {
    const filePath = temporaryFilePath();
    createSqliteChatStorage({ filePath }).close();
    expect(read<{ n: number }>(filePath, "select count(*) as n from __agent_chat_migrations")).toEqual([{ n: sdkEntries.length }]);
    expect(read(filePath, "select name from sqlite_master where name = '__drizzle_migrations'")).toEqual([]);
  });

  it("в файле журнал приложения новее миграций SDK — SDK всё равно создаёт свои таблицы", async () => {
    const filePath = temporaryFilePath();
    addAppMigration(filePath);
    const storage = createSqliteChatStorage({ filePath });
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: "m", providerId: "p" });
    expect(await storage.getChat("c1")).toMatchObject({ ownerId: "anna" });
    storage.close();
    expect(read(filePath, "select hash, created_at from __drizzle_migrations")).toEqual([{ hash: "миграция-приложения", created_at: appMigrationMillis }]);
  });

  it("файл SDK 0.31.2 с журналом приложения: записи SDK переезжают, миграции не повторяются, данные и журнал приложения целы", async () => {
    const filePath = oldSdkFile();
    addAppMigration(filePath);
    const before = read<{ hash: string; created_at: number }>(filePath, "select hash, created_at from __drizzle_migrations order by created_at");

    const storage = createSqliteChatStorage({ filePath });
    expect(await storage.getChat("c1")).toMatchObject({ ownerId: "anna" });
    expect((await storage.listMessages("c1")).map((message) => message.id)).toEqual(["m1"]);
    storage.close();

    const moved = read<{ hash: string; created_at: number }>(filePath, "select hash, created_at from __agent_chat_migrations order by created_at");
    expect(moved).toEqual(before.filter((row) => row.hash !== "миграция-приложения"));
    expect(moved.map((row) => Number(row.created_at))).toEqual(sdkEntries.map((entry) => entry.when));
    // Общий журнал не тронут: приложению ничего не мешает.
    expect(read(filePath, "select hash, created_at from __drizzle_migrations order by created_at")).toEqual(before);
    // Второе открытие ничего не переносит и не применяет заново.
    createSqliteChatStorage({ filePath }).close();
    expect(read(filePath, "select hash, created_at from __agent_chat_migrations order by created_at")).toEqual(moved);
  });

  it("старый SDK до 0014, потом миграция приложения: пропущенные раньше миграции SDK применяются, чаты целы", async () => {
    const filePath = oldSdkFile(migrationsThrough("0014_chat_origin"));
    addAppMigration(filePath);
    const storage = createSqliteChatStorage({ filePath });
    expect(await storage.getChat("c1")).toMatchObject({ ownerId: "anna" });
    // Столбцы поздних миграций на месте: закрытие чата (0016) работает.
    await storage.setChatClosed!("c1", { code: "done", message: "Готово" });
    expect((await storage.getChat("c1"))?.closed).toEqual({ code: "done", message: "Готово" });
    storage.close();
    expect(read<{ n: number }>(filePath, "select count(*) as n from __agent_chat_migrations")).toEqual([{ n: sdkEntries.length }]);
  });

  it("дыра в середине: старый SDK пропустил 0010, а 0011 и дальше применил — 0010 применяется, остальные не повторяются", async () => {
    const skipped = sdkEntries.find(({ tag }) => tag === "0010_memory_optimization")!;
    const filePath = oldSdkFile(migrationsWithout(skipped.tag));
    addAppMigration(filePath, skipped.when + 1);
    expect(read(filePath, "select name from sqlite_master where name = 'memory_optimization_runs'")).toEqual([]);

    const storage = createSqliteChatStorage({ filePath });
    expect(await storage.getChat("c1")).toMatchObject({ ownerId: "anna" });
    expect((await storage.listMessages("c1")).map((message) => message.id)).toEqual(["m1"]);
    // Таблица и столбец из 0010 на месте: оптимизация памяти работает.
    await storage.insertMemoryNotes!("anna", [{ categories: ["preference"], content: "Любит чай" }]);
    expect(await storage.claimMemoryOptimizationRun!("anna", { minIntervalMs: 0, retryAfterFailureMs: 0, leaseMs: 60_000 }, "2026-10-07T00:00:00.000Z")).toBeTruthy();
    storage.close();

    const journal = () => read<{ created_at: number }>(filePath, "select created_at from __agent_chat_migrations order by created_at").map((row) => Number(row.created_at));
    expect(journal()).toEqual(sdkEntries.map((entry) => entry.when));
    createSqliteChatStorage({ filePath }).close();
    expect(journal()).toEqual(sdkEntries.map((entry) => entry.when));
  });

  it("миграции, которые могли пропасть до 0.32, только добавляют: их можно применить не по порядку", () => {
    // Последняя миграция SDK 0.31.2. Новые миграции идут по своему журналу и пропасть не могут.
    const lastShared = sdkEntries.findIndex(({ tag }) => tag === "0016_chat_closed");
    expect(lastShared).toBeGreaterThan(0);
    const statements = sdkEntries
      .slice(0, lastShared + 1)
      .flatMap(({ tag }) => readFileSync(join(sdkMigrations, `${tag}.sql`), "utf8").split("--> statement-breakpoint"))
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter(Boolean);
    const additive = /^(CREATE TABLE|CREATE (UNIQUE )?INDEX|DROP INDEX|ALTER TABLE `\w+` ADD `|UPDATE `\w+` SET )/;
    expect(statements.filter((statement) => !additive.test(statement))).toEqual([]);
  });

  it("журнал приложения с другими колонками — переносить нечего, свои таблицы SDK создаются", async () => {
    const filePath = temporaryFilePath();
    const raw = new Database(filePath);
    raw.exec("create table __drizzle_migrations (version integer primary key, name text)");
    raw.exec("insert into __drizzle_migrations values (1, 'init')");
    raw.close();
    const storage = createSqliteChatStorage({ filePath });
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: "m", providerId: "p" });
    storage.close();
    expect(read(filePath, "select version, name from __drizzle_migrations")).toEqual([{ version: 1, name: "init" }]);
  });
});
