import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../../../storage-sqlite/src/sqlite-storage";
import { fileURLToPath } from "node:url";
import { sqliteFlowStore } from "../../src/sqlite";
import { createSqliteFlowStore, type SqliteFlowStore } from "../../src/store/sqlite";
import { at, chatInput, describeFlowStoreContract, exampleFlow } from "./flow-store-contract";

const folders: string[] = [];
const opened: SqliteFlowStore[] = [];
const MIGRATIONS = fileURLToPath(new URL("../../drizzle/sqlite", import.meta.url));
function freshFile(): string {
  const folder = mkdtempSync(join(tmpdir(), "agent-flows-"));
  folders.push(folder);
  return join(folder, "flows.sqlite");
}
function open(filePath: string): SqliteFlowStore {
  const store = createSqliteFlowStore(filePath, MIGRATIONS);
  opened.push(store);
  return store;
}
afterEach(async () => {
  for (const store of opened.splice(0)) await store.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function countRows(filePath: string, table: string): number {
  const database = new Database(filePath, { readonly: true });
  try {
    return (database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  } finally {
    database.close();
  }
}

describe("сценарии в SQLite", () => {
  describeFlowStoreContract(async () => {
    const filePath = freshFile();
    const first = open(filePath);
    const second = open(filePath);
    return { first, second, close: async () => {} };
  });

  it("перезапуск: чат, версия, карточка и таймер на месте; наступивший таймер срабатывает один раз", async () => {
    const filePath = freshFile();
    const input = chatInput();
    const flow = exampleFlow();
    const before = open(filePath);
    await before.pinChat(input);
    await before.saveVersion({ flowId: flow.id, versionId: "v1", hash: "h", flow, at: at(0) });
    await before.writeCardField({ ownerId: "anna", fieldId: "sales", value: 3, chatId: input.chatId, flowId: flow.id, at: at(0) });
    await before.setDue(input.chatId, { at: at(10), exitId: "x4", branchHead: "m1" });
    // Копия взяла таймер и упала, не отпустив.
    expect(await before.leaseDue({ now: at(10), owner: "old", leaseMs: 60_000, limit: 10 })).toHaveLength(1);
    await before.close();

    const after = open(filePath);
    const other = open(filePath);
    expect(await after.getChat(input.chatId)).toMatchObject({ dueAt: at(10), dueExitId: "x4", dueBranchHead: "m1" });
    expect((await after.getVersion(flow.id, "v1"))?.flow).toEqual(flow);
    expect(await after.readCard("anna")).toMatchObject([{ fieldId: "sales", value: 3 }]);
    expect(await after.leaseDue({ now: at(30), owner: "new", leaseMs: 60_000, limit: 10 })).toEqual([]);
    const [one, two] = await Promise.all([
      after.leaseDue({ now: at(71), owner: "new", leaseMs: 60_000, limit: 10 }),
      other.leaseDue({ now: at(71), owner: "other", leaseMs: 60_000, limit: 10 }),
    ]);
    expect(one.length + two.length).toBe(1);
  });

  it("миграции хранилища чатов и сценариев в одном файле работают в любом порядке", async () => {
    for (const order of ["storage-first", "flows-first"] as const) {
      const filePath = freshFile();
      const storage = order === "storage-first" ? createSqliteChatStorage({ filePath }) : undefined;
      const flows = open(filePath);
      const chats = storage ?? createSqliteChatStorage({ filePath });
      await flows.pinChat(chatInput({ chatId: `chat-${order}` }));
      await chats.createChat({ id: `chat-${order}`, ownerId: "u", modelId: "m", providerId: "p" });
      expect((await chats.listChats("u")).length).toBe(1);
      expect(await flows.getChat(`chat-${order}`)).not.toBeNull();
      chats.close();

      const database = new Database(filePath, { readonly: true });
      const tables = (database.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
      database.close();
      expect(tables).toEqual(expect.arrayContaining(["chats", "messages", "flow_chats", "flow_versions", "flow_client_cards", "flow_first_messages", "flow_people", "flow_side_tasks", "__agent_chat_migrations", "__flows_migrations"]));
    }
  });

  it("вход ./sqlite открывает то же хранилище с миграциями пакета", async () => {
    const filePath = freshFile();
    const store = sqliteFlowStore(filePath);
    await store.pinChat(chatInput({ chatId: "через-вход" }));
    expect(await open(filePath).getChat("через-вход")).toMatchObject({ chatId: "через-вход" });
    // `close` виден через вход без приведения типов и закрывает файл.
    await store.close();
    await expect(store.getChat("через-вход")).rejects.toThrow();
  });

  it("повторное открытие не применяет миграции заново", async () => {
    const filePath = freshFile();
    await open(filePath).close();
    const applied = countRows(filePath, "__flows_migrations");
    expect(applied).toBeGreaterThan(0);
    await open(filePath).close();
    expect(countRows(filePath, "__flows_migrations")).toBe(applied);
  });
});


it("обновление базы до transitionMode оставляет старые запуски в rails", async () => {
  const file = freshFile(); const oldFolder = `${file}-old-migrations`;
  folders.push(oldFolder); cpSync(MIGRATIONS, oldFolder, { recursive: true });
  const journalPath = join(oldFolder, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")); journal.entries = journal.entries.slice(0, 4); writeFileSync(journalPath, JSON.stringify(journal));
  const old = createSqliteFlowStore(file, oldFolder); await old.close();
  const raw = new Database(file);
  expect((raw.pragma("table_info(flow_chats)") as Array<{ name: string }>).some(column => column.name === "transition_mode")).toBe(false);
  raw.prepare("insert into flow_chats (chat_id,owner_id,flow_id,version_id,state_id,pending,time_zone,updated_at) values (?,?,?,?,?,?,?,?)").run("old", "anna", "flow", "v1", "intro", "[]", "UTC", 0); raw.close();
  const upgraded = open(file);
  expect(await upgraded.getChat("old")).toMatchObject({ transitionMode: "rails", stateId: "intro" });
});
