import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../../../storage-sqlite/src/sqlite-storage";
import { createSqliteSandboxJournal } from "../../src/sqlite";
import { describeSandboxJournalContract } from "./journal-contract";
import { modelCallEvent } from "./support/events";

const folders: string[] = [];
function freshFile(): string {
  const folder = mkdtempSync(join(tmpdir(), "sandbox-journal-"));
  folders.push(folder);
  return join(folder, "journal.sqlite");
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

describe("журнал в SQLite", () => {
  describeSandboxJournalContract(async (options) => {
    const filePath = freshFile();
    return { journal: await createSqliteSandboxJournal({ filePath, ...options }), blobCount: async () => countRows(filePath, "sandbox_blobs") };
  });

  it("данные переживают переоткрытие файла", async () => {
    const filePath = freshFile();
    const first = await createSqliteSandboxJournal({ filePath, env: {} });
    const event = modelCallEvent({ chatId: "persist" });
    first.enqueueModelCall(event);
    await first.close();
    const second = await createSqliteSandboxJournal({ filePath, env: {} });
    expect((await second.listForChat("persist")).map((entry) => entry.id)).toEqual([event.callId]);
    await second.close();
  });

  it("миграции хранилища и журнала в одном файле работают в любом порядке", async () => {
    for (const order of ["storage-first", "journal-first"] as const) {
      const filePath = freshFile();
      let journal;
      let storage;
      if (order === "storage-first") {
        storage = createSqliteChatStorage({ filePath });
        journal = await createSqliteSandboxJournal({ filePath, env: {} });
      } else {
        journal = await createSqliteSandboxJournal({ filePath, env: {} });
        storage = createSqliteChatStorage({ filePath });
      }
      const event = modelCallEvent({ chatId: `chat-${order}` });
      journal.enqueueModelCall(event);
      await journal.flush();
      expect((await journal.listForChat(`chat-${order}`)).length).toBe(1);
      await storage.createChat({ id: `chat-${order}`, ownerId: "u", modelId: "m", providerId: "p" });
      expect((await storage.listChats("u")).length).toBe(1);
      await journal.close();
      storage.close();

      const database = new Database(filePath, { readonly: true });
      const tables = (database.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
      database.close();
      expect(tables).toEqual(expect.arrayContaining(["chats", "messages", "sandbox_model_calls", "sandbox_tool_calls", "sandbox_blobs", "__agent_chat_migrations", "__sandbox_migrations"]));
    }
  });

  it("повторное открытие не применяет миграции заново", async () => {
    const filePath = freshFile();
    await (await createSqliteSandboxJournal({ filePath, env: {} })).close();
    const applied = countRows(filePath, "__sandbox_migrations");
    expect(applied).toBeGreaterThan(0);
    await (await createSqliteSandboxJournal({ filePath, env: {} })).close();
    expect(countRows(filePath, "__sandbox_migrations")).toBe(applied);
  });
});
