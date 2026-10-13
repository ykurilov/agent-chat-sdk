import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostgresChatStorage } from "../../../storage-postgres/src/postgres-storage";
import { createPostgresSandboxJournal } from "../../src/postgres";
import { describeSandboxJournalContract } from "./journal-contract";
import { startTemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import { modelCallEvent, textMessage, toolCallEvent } from "./support/events";

const databases: TemporaryPostgres[] = [];
async function freshDatabase(): Promise<TemporaryPostgres> {
  const database = await startTemporaryPostgres();
  databases.push(database);
  return database;
}
afterEach(async () => {
  for (const database of databases.splice(0)) await database.stop();
});

async function query(connectionString: string, text: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
}

describe("журнал в PostgreSQL (встроенная база pglite за обычным протоколом)", () => {
  describeSandboxJournalContract(async (options) => {
    const database = await freshDatabase();
    const journal = await createPostgresSandboxJournal({ connectionString: database.connectionString, poolSize: 1, ...options });
    return { journal, blobCount: async () => Number((await query(database.connectionString, "select count(*) as n from agent_chat.sandbox_blobs"))[0]?.n) };
  });

  it("символ NUL в ошибке и инструкции не ломает запись", async () => {
    const database = await freshDatabase();
    const journal = await createPostgresSandboxJournal({ connectionString: database.connectionString, poolSize: 1, env: {}, logError: (message) => { throw new Error(message); } });
    const event = modelCallEvent({ chatId: "nul", status: "error", error: "сбой\u0000провайдера" });
    journal.enqueueModelCall(event);
    journal.enqueueToolCall(toolCallEvent({ chatId: "nul", error: "ошибка\u0000инструмента" }));
    await journal.flush();
    const entries = await journal.listForChat("nul");
    expect(entries.map((entry) => entry.error)).toEqual(expect.arrayContaining(["сбойпровайдера", "ошибкаинструмента"]));
    await journal.setSettings({ chatId: "nul", instructions: "Ты\u0000помощник", updatedBy: "anna", updatedAt: new Date() });
    expect((await journal.getSettings("nul"))?.instructions).toBe("Тыпомощник");
    await journal.close();
  });

  it("обращение с длинной историей пишется горсткой запросов, а не запросом на каждое сообщение", async () => {
    const database = await freshDatabase();
    const journal = await createPostgresSandboxJournal({ connectionString: database.connectionString, poolSize: 1, env: {} });
    const messages = Array.from({ length: 100 }, (_, index) => textMessage(index % 2 === 0 ? "user" : "assistant", `сообщение ${index}`));
    const queries = vi.spyOn(pg.Client.prototype, "query");
    try {
      journal.enqueueModelCall(modelCallEvent({ chatId: "long", request: { ...modelCallEvent().request, messages } }));
      await journal.flush();
      // begin, само обращение, куски, ссылки на куски, commit
      expect(queries.mock.calls.length).toBeLessThanOrEqual(5);
    } finally {
      queries.mockRestore();
    }
    expect(await journal.listForChat("long")).toHaveLength(1);
    await journal.close();
  });

  it("данные переживают переоткрытие базы", async () => {
    const database = await freshDatabase();
    const first = await createPostgresSandboxJournal({ connectionString: database.connectionString, poolSize: 1, env: {} });
    const event = modelCallEvent({ chatId: "persist" });
    first.enqueueModelCall(event);
    await first.close();
    const second = await createPostgresSandboxJournal({ connectionString: database.connectionString, poolSize: 1, env: {} });
    expect((await second.listForChat("persist")).map((entry) => entry.id)).toEqual([event.callId]);
    await second.close();
  });

  it("миграции хранилища и журнала в одной базе работают в любом порядке", async () => {
    for (const order of ["storage-first", "journal-first"] as const) {
      const database = await freshDatabase();
      const open = {
        storage: () => createPostgresChatStorage({ connectionString: database.connectionString, poolSize: 1, logError: () => {} }),
        journal: () => createPostgresSandboxJournal({ connectionString: database.connectionString, poolSize: 1, env: {} }),
      };
      const opened = order === "storage-first" ? [await open.storage(), await open.journal()] : [await open.journal(), await open.storage()];
      const [storage, journal] = order === "storage-first" ? [opened[0], opened[1]] : [opened[1], opened[0]];
      const chatId = `chat-${order}`;
      (journal as Awaited<ReturnType<typeof open.journal>>).enqueueModelCall(modelCallEvent({ chatId }));
      await (journal as Awaited<ReturnType<typeof open.journal>>).flush();
      expect(await (journal as Awaited<ReturnType<typeof open.journal>>).listForChat(chatId)).toHaveLength(1);
      await (storage as Awaited<ReturnType<typeof open.storage>>).createChat({ id: chatId, ownerId: "u", modelId: "m", providerId: "p" });
      expect(await (storage as Awaited<ReturnType<typeof open.storage>>).listChats("u")).toHaveLength(1);
      await (journal as Awaited<ReturnType<typeof open.journal>>).close();
      await (storage as Awaited<ReturnType<typeof open.storage>>).close();

      const tables = (await query(database.connectionString, "select table_name from information_schema.tables where table_schema = 'agent_chat'")).map((row) => row.table_name);
      expect(tables).toEqual(expect.arrayContaining(["chats", "messages", "sandbox_model_calls", "sandbox_tool_calls", "sandbox_blobs", "__drizzle_migrations", "__sandbox_migrations"]));
    }
  });
});
