import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createPostgresChatStorage } from "../../../storage-postgres/src/postgres-storage";
import { startTemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import { postgresTaskStore } from "../../src/postgres";
import { describeTaskStoreContract, taskRecord } from "./task-store-contract";

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

describe("задачи в PostgreSQL (встроенная база pglite за обычным протоколом)", () => {
  describeTaskStoreContract(async () => {
    const database = await freshDatabase();
    const pools = [new pg.Pool({ connectionString: database.connectionString, max: 2 }), new pg.Pool({ connectionString: database.connectionString, max: 2 })];
    // В pglite блокировка миграций общая и ничего не исключает: вторая ручка открывается после миграции первой.
    const first = postgresTaskStore(pools[0]!);
    await first.countActive("nobody");
    return {
      first,
      second: postgresTaskStore(pools[1]!),
      async close() {
        for (const pool of pools) await pool.end();
      },
    };
  });

  it("закрытие хранилища не закрывает пул приложения", async () => {
    const database = await freshDatabase();
    const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
    const store = postgresTaskStore(pool);
    await store.create(taskRecord());
    await store.close?.();
    expect((await pool.query("select 1 as one")).rows[0]).toEqual({ one: 1 });
    await pool.end();
  });

  it("символ NUL в названии, ошибке и результате не ломает запись", async () => {
    const database = await freshDatabase();
    const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
    const store = postgresTaskStore(pool);
    const task = taskRecord({ title: "отчёт\u0000", status: "failed", error: "сбой\u0000", result: { text: "a\u0000b" } });
    await store.create(task);
    expect(await store.get(task.ownerId, task.id)).toMatchObject({ title: "отчёт", error: "сбой", result: { text: "ab" } });
    await store.update(task.ownerId, task.id, { error: "ещё\u0000" });
    expect((await store.get(task.ownerId, task.id))?.error).toBe("ещё");
    await pool.end();
  });

  it("миграции хранилища чатов и фона в одной базе работают в любом порядке", async () => {
    for (const order of ["storage-first", "tasks-first"] as const) {
      const database = await freshDatabase();
      const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
      const openStorage = () => createPostgresChatStorage({ connectionString: database.connectionString, poolSize: 1, logError: () => {} });
      let storage = order === "storage-first" ? await openStorage() : undefined;
      const tasks = postgresTaskStore(pool);
      const task = taskRecord({ chatId: `chat-${order}` });
      await tasks.create(task);
      storage ??= await openStorage();
      await storage.createChat({ id: `chat-${order}`, ownerId: "u", modelId: "m", providerId: "p" });
      expect((await storage.listChats("u")).length).toBe(1);
      expect((await tasks.listForChat(task.ownerId, task.chatId)).length).toBe(1);
      await storage.close();
      await pool.end();

      const tables = (await query(database.connectionString, "select table_name from information_schema.tables where table_schema = 'agent_chat'")).map((row) => row.table_name);
      expect(tables).toEqual(expect.arrayContaining(["chats", "messages", "background_tasks", "__drizzle_migrations", "__background_migrations"]));
    }
  });

  it("повторное открытие не применяет миграции заново", async () => {
    const database = await freshDatabase();
    const count = async () => Number((await query(database.connectionString, "select count(*) as n from agent_chat.__background_migrations"))[0]?.n);
    for (let round = 0; round < 2; round += 1) {
      const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
      await postgresTaskStore(pool).listForChat("u", "c");
      await pool.end();
    }
    expect(await count()).toBeGreaterThan(0);
    const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
    const before = await count();
    await postgresTaskStore(pool).listForChat("u", "c");
    await pool.end();
    expect(await count()).toBe(before);
  });
});
