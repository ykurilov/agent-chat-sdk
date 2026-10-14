import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createPostgresChatStorage } from "../../../storage-postgres/src/postgres-storage";
import { startTemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import { assertSafeToWipe } from "../../../storage-postgres/tests/support/wipe-guard";
import { postgresFlowStore } from "../../src/postgres";
import { createPostgresFlowStore, type PostgresFlowStore } from "../../src/store/postgres";
import { at, chatInput, describeFlowStoreContract, exampleFlow } from "./flow-store-contract";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle/postgres", import.meta.url));

const databases: TemporaryPostgres[] = [];
const pools: pg.Pool[] = [];
async function freshDatabase(): Promise<TemporaryPostgres> {
  const database = await startTemporaryPostgres();
  databases.push(database);
  return database;
}
function pool(connectionString: string, max = 2): pg.Pool {
  const created = new pg.Pool({ connectionString, max });
  pools.push(created);
  return created;
}
afterEach(async () => {
  for (const created of pools.splice(0)) await created.end();
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

const open = (connectionString: string, max = 2): PostgresFlowStore => createPostgresFlowStore(pool(connectionString, max), MIGRATIONS);

describe("сценарии в PostgreSQL (встроенная база pglite за обычным протоколом)", () => {
  describeFlowStoreContract(async () => {
    const database = await freshDatabase();
    // В pglite блокировка миграций общая и ничего не исключает: вторая ручка открывается после миграции первой.
    const first = open(database.connectionString);
    await first.getChat("nobody");
    return { first, second: open(database.connectionString), close: async () => {} };
  });

  it("вход ./postgres открывает то же хранилище; закрытие хранилища не закрывает пул приложения", async () => {
    const database = await freshDatabase();
    const appPool = pool(database.connectionString, 1);
    const entry = postgresFlowStore(appPool);
    await entry.pinChat(chatInput({ chatId: "через-вход" }));
    // `close` виден через вход без приведения типов.
    await entry.close();
    const store = createPostgresFlowStore(appPool, MIGRATIONS);
    expect(await store.getChat("через-вход")).toMatchObject({ chatId: "через-вход" });
    await store.close();
    expect((await appPool.query("select 1 as one")).rows[0]).toEqual({ one: 1 });
  });

  it("символ NUL в карточке, ожидающем и сценарии не ломает запись", async () => {
    const database = await freshDatabase();
    const store = open(database.connectionString);
    const input = chatInput();
    await store.pinChat(input);
    await store.writeCardField({ ownerId: "anna", fieldId: "name", value: { text: "Ан\u0000на" }, chatId: input.chatId, flowId: "f", at: at(1) });
    expect((await store.readCard("anna"))[0]?.value).toEqual({ text: "Анна" });
    await store.addPending(input.chatId, { kind: "event", key: "e\u00001", name: "paid", data: "a\u0000b", at: at(1) });
    expect(await store.takePending(input.chatId)).toEqual([{ kind: "event", key: "e1", name: "paid", data: "ab", at: at(1) }]);
    const flow = { ...exampleFlow(), common: "Цена\u0000 4900" };
    await store.saveVersion({ flowId: flow.id, versionId: "v1", hash: "h", flow, at: at(1) });
    expect((await store.getVersion(flow.id, "v1"))?.flow.common).toBe("Цена 4900");
  });

  it("перезапуск: чат и таймер на месте; таймер упавшей копии берёт новая после срока аренды", async () => {
    const database = await freshDatabase();
    const input = chatInput();
    const before = open(database.connectionString);
    await before.pinChat(input);
    await before.setDue(input.chatId, { at: at(10), exitId: "x4", branchHead: "m1" });
    expect(await before.leaseDue({ now: at(10), owner: "old", leaseMs: 60_000, limit: 10 })).toHaveLength(1);
    await before.close();
    for (const created of pools.splice(0)) await created.end();

    const after = open(database.connectionString);
    expect(await after.getChat(input.chatId)).toMatchObject({ dueAt: at(10), dueExitId: "x4", dueBranchHead: "m1" });
    expect(await after.leaseDue({ now: at(30), owner: "new", leaseMs: 60_000, limit: 10 })).toEqual([]);
    expect(await after.leaseDue({ now: at(71), owner: "new", leaseMs: 60_000, limit: 10 })).toHaveLength(1);
  });

  it("миграции хранилища чатов и сценариев в одной базе работают в любом порядке", async () => {
    for (const order of ["storage-first", "flows-first"] as const) {
      const database = await freshDatabase();
      const openStorage = () => createPostgresChatStorage({ connectionString: database.connectionString, poolSize: 1, logError: () => {} });
      let storage = order === "storage-first" ? await openStorage() : undefined;
      const flows = open(database.connectionString, 1);
      await flows.pinChat(chatInput({ chatId: `chat-${order}` }));
      storage ??= await openStorage();
      await storage.createChat({ id: `chat-${order}`, ownerId: "u", modelId: "m", providerId: "p" });
      expect((await storage.listChats("u")).length).toBe(1);
      expect(await flows.getChat(`chat-${order}`)).not.toBeNull();
      await storage.close();
      for (const created of pools.splice(0)) await created.end();

      const tables = (await query(database.connectionString, "select table_name from information_schema.tables where table_schema = 'agent_chat'")).map((row) => row.table_name);
      expect(tables).toEqual(expect.arrayContaining(["chats", "messages", "flow_chats", "flow_versions", "flow_client_cards", "flow_first_messages", "__drizzle_migrations", "__flows_migrations"]));
    }
  });

  it("повторное открытие не применяет миграции заново", async () => {
    const database = await freshDatabase();
    const count = async () => Number((await query(database.connectionString, "select count(*) as n from agent_chat.__flows_migrations"))[0]?.n);
    await open(database.connectionString, 1).getChat("x");
    const applied = await count();
    expect(applied).toBeGreaterThan(0);
    await open(database.connectionString, 1).getChat("x");
    expect(await count()).toBe(applied);
  });
});

/**
 * Настоящий PostgreSQL: pglite склеивает подключения в одно, а блокировку миграций и аренду наперегонки можно проверить
 * только на нескольких. Включается переменной `AGENT_CHAT_TEST_POSTGRES_URL=postgres://localhost:5432/agent_chat_test`.
 * Схема `agent_chat` в этой базе стирается, поэтому имя базы должно содержать `test` (см. `wipe-guard.ts`).
 */
const realPostgresUrl = process.env.AGENT_CHAT_TEST_POSTGRES_URL;

describe.skipIf(!realPostgresUrl)("сценарии в PostgreSQL (настоящий сервер)", () => {
  if (realPostgresUrl) assertSafeToWipe(realPostgresUrl);

  async function cleanSchema(): Promise<void> {
    await query(realPostgresUrl!, "drop schema if exists agent_chat cascade");
  }

  describeFlowStoreContract(async () => {
    await cleanSchema();
    const first = open(realPostgresUrl!, 5);
    const second = open(realPostgresUrl!, 5);
    return { first, second, close: async () => {} };
  });

  it("три копии стартуют одновременно на пустой схеме (10 повторов)", async () => {
    for (let round = 0; round < 10; round += 1) {
      await cleanSchema();
      const stores = [1, 2, 3].map(() => open(realPostgresUrl!, 2));
      const input = chatInput();
      await Promise.all(stores.map((store) => store.pinChat(input)));
      expect(await stores[2]!.getChat(input.chatId)).toMatchObject({ chatId: input.chatId });
      for (const created of pools.splice(0)) await created.end();
    }
  }, 120_000);

  it("четыре копии наперегонки берут 200 таймеров: каждый ровно один раз", async () => {
    await cleanSchema();
    const stores = [1, 2, 3, 4].map(() => open(realPostgresUrl!, 4));
    const chats = Array.from({ length: 200 }, () => chatInput());
    for (const [index, input] of chats.entries()) {
      await stores[0]!.pinChat(input);
      await stores[0]!.setDue(input.chatId, { at: at(index % 7), exitId: "x4", branchHead: null });
    }
    const taken: string[] = [];
    await Promise.all(
      stores.map(async (store, copy) => {
        for (;;) {
          const batch = await store.leaseDue({ now: at(100), owner: `copy-${copy}`, leaseMs: 60_000, limit: 7 });
          if (batch.length === 0) return;
          taken.push(...batch.map((chat) => chat.chatId));
        }
      }),
    );
    expect(taken.length).toBe(200);
    expect(new Set(taken).size).toBe(200);
  }, 60_000);
});
