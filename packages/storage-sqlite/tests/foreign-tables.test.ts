import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage, ForeignChatTablesError } from "../src/sqlite-storage";

const directories: string[] = [];

function temporaryFilePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "agent-chat-foreign-"));
  directories.push(directory);
  return join(directory, "app.sqlite");
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Файл приложения со своими таблицами: `statements` выполняются как есть. */
function appFile(...statements: string[]): string {
  const filePath = temporaryFilePath();
  const raw = new Database(filePath);
  for (const statement of statements) raw.exec(statement);
  raw.close();
  return filePath;
}

function schemaOf(filePath: string): unknown[] {
  const raw = new Database(filePath, { readonly: true });
  try {
    return raw.prepare("select type, name, sql from sqlite_master order by name").all();
  } finally {
    raw.close();
  }
}

const formsChats = "create table chats (id text primary key, form_id text not null, status text)";
const formsMessages = "create table messages (id text primary key, chat_id text not null, body text)";

describe("защита от чужих таблиц chats и messages", () => {
  it("в файле приложения свои chats и messages — понятная ошибка, файл не тронут", () => {
    const filePath = appFile(formsChats, formsMessages, "insert into chats values ('c1', 'f1', 'open')");
    const before = schemaOf(filePath);
    let thrown: unknown;
    try {
      createSqliteChatStorage({ filePath });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ForeignChatTablesError);
    expect((thrown as Error).message).toContain("chats");
    expect((thrown as Error).message).toContain("messages");
    expect((thrown as Error).message).toContain("отдельный файл");
    expect((thrown as Error).message).toContain(filePath);
    // Ни таблиц SDK, ни журнала миграций: файл такой же, как был.
    expect(schemaOf(filePath)).toEqual(before);
    const raw = new Database(filePath, { readonly: true });
    expect(raw.prepare("select id, form_id from chats").all()).toEqual([{ id: "c1", form_id: "f1" }]);
    raw.close();
  });

  it("чужая только chats или только messages — тоже ошибка, названа найденная таблица", () => {
    const onlyChats = appFile(formsChats);
    expect(() => createSqliteChatStorage({ filePath: onlyChats })).toThrow(ForeignChatTablesError);
    expect(() => createSqliteChatStorage({ filePath: onlyChats })).toThrow(/chats/);
    const onlyMessages = appFile(formsMessages);
    expect(() => createSqliteChatStorage({ filePath: onlyMessages })).toThrow(/messages/);
    expect(schemaOf(onlyChats)).toHaveLength(2);
  });

  it("свой журнал миграций drizzle у приложения не делает таблицы нашими", () => {
    const filePath = appFile(
      formsChats,
      "create table __drizzle_migrations (id integer primary key autoincrement, hash text not null, created_at numeric)",
      "insert into __drizzle_migrations (hash, created_at) values ('чужой-хеш', 1)",
    );
    expect(() => createSqliteChatStorage({ filePath })).toThrow(ForeignChatTablesError);
  });

  it("в файле только другие таблицы приложения — SDK создаёт свои рядом, чужие целы", async () => {
    const filePath = appFile("create table forms (id text primary key, title text)", "insert into forms values ('f1', 'Анкета')");
    const storage = createSqliteChatStorage({ filePath });
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: "m", providerId: "p" });
    storage.close();
    const raw = new Database(filePath, { readonly: true });
    expect(raw.prepare("select title from forms").all()).toEqual([{ title: "Анкета" }]);
    raw.close();
  });

  it("свой файл SDK открывается много раз; новый и пустой файл — тоже", async () => {
    const filePath = temporaryFilePath();
    const first = createSqliteChatStorage({ filePath });
    await first.createChat({ id: "c1", ownerId: "anna", modelId: "m", providerId: "p" });
    first.close();
    const second = createSqliteChatStorage({ filePath });
    expect(await second.getChat("c1")).toMatchObject({ ownerId: "anna" });
    second.close();
    const empty = createSqliteChatStorage({ filePath: appFile() });
    empty.close();
  });

  describe("файл старого SDK (журнал до миграции с данными объекта)", () => {
    /** Папка с миграциями до `lastTag` включительно: так выглядела база прежней версии SDK. */
    function migrationsThrough(lastTag: string): string {
      const source = fileURLToPath(new URL("../drizzle", import.meta.url));
      const target = mkdtempSync(join(tmpdir(), "agent-chat-old-migrations-"));
      directories.push(target);
      mkdirSync(join(target, "meta"));
      const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
      const entries = journal.entries.slice(0, journal.entries.findIndex(({ tag }) => tag === lastTag) + 1);
      for (const { tag } of entries) cpSync(join(source, `${tag}.sql`), join(target, `${tag}.sql`));
      writeFileSync(join(target, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
      return target;
    }

    it("журнал до 0014 (нет столбцов subject_key и subject_data): защита пускает, миграции догоняют, чаты целы, данные чата работают", async () => {
      const filePath = temporaryFilePath();
      const old = new Database(filePath);
      migrate(drizzle(old), { migrationsFolder: migrationsThrough("0014_chat_origin") });
      expect(old.prepare("select name from pragma_table_info('chats')").pluck().all()).not.toContain("subject_data");
      const now = "2026-01-01T00:00:00.000Z";
      old.prepare("insert into chats (id, owner_id, model_id, provider_id, created_at, updated_at) values ('c1','anna','m','p',?,?)").run(now, now);
      old.prepare(
        "insert into messages (id, chat_id, parent_id, role, parts, format_version, status, reasoning_durations_ms, created_at, seq) values ('m1','c1',null,'user',?,1,'complete','{}',?,1)",
      ).run(JSON.stringify([{ type: "text", text: "Привет" }]), now);
      old.close();

      const storage = createSqliteChatStorage({ filePath });
      expect(await storage.getChat("c1")).toMatchObject({ ownerId: "anna" });
      expect(await storage.getChat("c1")).not.toHaveProperty("data");
      expect((await storage.listMessages("c1")).map((message) => message.id)).toEqual(["m1"]);
      const updated = await storage.updateChatData!("c1", { formId: "f1" }, { maxBytes: 16 * 1024 });
      expect(updated?.data).toEqual({ formId: "f1" });
      expect((await storage.listChats("anna", { data: { formId: "f1" } })).map((chat) => chat.id)).toEqual(["c1"]);
      storage.close();
      const raw = new Database(filePath, { readonly: true });
      expect(raw.prepare("select name from pragma_table_info('chats')").pluck().all()).toContain("subject_data");
      raw.close();
    });
  });
});
