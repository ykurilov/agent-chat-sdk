import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../../../storage-sqlite/src/sqlite-storage";
import { sqliteTaskStore } from "../../src/sqlite";
import { describeTaskStoreContract, taskRecord } from "./task-store-contract";

const folders: string[] = [];
function freshFile(): string {
  const folder = mkdtempSync(join(tmpdir(), "background-tasks-"));
  folders.push(folder);
  return join(folder, "tasks.sqlite");
}
afterEach(() => {
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

describe("задачи в SQLite", () => {
  describeTaskStoreContract(async () => {
    const filePath = freshFile();
    const first = sqliteTaskStore(filePath);
    const second = sqliteTaskStore(filePath);
    return {
      first,
      second,
      async close() {
        await first.close?.();
        await second.close?.();
      },
    };
  });

  it("задачи переживают переоткрытие файла", async () => {
    const filePath = freshFile();
    const task = taskRecord();
    const first = sqliteTaskStore(filePath);
    await first.create(task);
    await first.close?.();
    const second = sqliteTaskStore(filePath);
    expect(await second.get(task.ownerId, task.id)).toEqual(task);
    await second.close?.();
  });

  it("миграции хранилища чатов и фона в одном файле работают в любом порядке", async () => {
    for (const order of ["storage-first", "tasks-first"] as const) {
      const filePath = freshFile();
      const storage = order === "storage-first" ? createSqliteChatStorage({ filePath }) : undefined;
      const tasks = sqliteTaskStore(filePath);
      const chats = storage ?? createSqliteChatStorage({ filePath });
      const task = taskRecord({ chatId: `chat-${order}` });
      await tasks.create(task);
      expect((await tasks.listForChat(task.ownerId, task.chatId)).length).toBe(1);
      await chats.createChat({ id: `chat-${order}`, ownerId: "u", modelId: "m", providerId: "p" });
      expect((await chats.listChats("u")).length).toBe(1);
      await tasks.close?.();
      chats.close();

      const database = new Database(filePath, { readonly: true });
      const tables = (database.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
      database.close();
      expect(tables).toEqual(expect.arrayContaining(["chats", "messages", "background_tasks", "__agent_chat_migrations", "__background_migrations"]));
    }
  });

  it("повторное открытие не применяет миграции заново", async () => {
    const filePath = freshFile();
    await sqliteTaskStore(filePath).close?.();
    const applied = countRows(filePath, "__background_migrations");
    expect(applied).toBeGreaterThan(0);
    await sqliteTaskStore(filePath).close?.();
    expect(countRows(filePath, "__background_migrations")).toBe(applied);
  });
});
