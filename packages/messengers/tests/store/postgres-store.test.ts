import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostgresChatStorage } from "../../../storage-postgres/src/postgres-storage";
import { startTemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import type { TemporaryPostgres } from "../../../storage-postgres/tests/support/pglite-server";
import { createPostgresMessengerStore } from "../../src/postgres";
import { describeMessengerStoreContract } from "./messenger-store-contract";

const databases: TemporaryPostgres[] = [];
async function freshDatabase(): Promise<TemporaryPostgres> {
  const database = await startTemporaryPostgres();
  databases.push(database);
  return database;
}
afterEach(async () => {
  for (const database of databases.splice(0)) await database.stop();
});

describe("хранилище мессенджеров в PostgreSQL (pglite за обычным протоколом)", () => {
  describeMessengerStoreContract(async () => createPostgresMessengerStore({ connectionString: (await freshDatabase()).connectionString, poolSize: 1 }));

  it("таблицы — в схеме agent_chat, своя таблица учёта миграций", async () => {
    const database = await freshDatabase();
    const store = await createPostgresMessengerStore({ connectionString: database.connectionString, poolSize: 1 });
    await store.close?.();
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const rows = (await client.query("select table_name from information_schema.tables where table_schema = 'agent_chat' order by table_name")).rows.map((row) => row.table_name);
      expect(rows).toEqual(expect.arrayContaining(["__messengers_migrations", "messenger_links", "messenger_updates", "messenger_leases"]));
    } finally {
      await client.end();
    }
  });

  it("символ NUL от мессенджера или модели не ломает запись: Postgres его не хранит, он убирается", async () => {
    const database = await freshDatabase();
    const store = await createPostgresMessengerStore({ connectionString: database.connectionString, poolSize: 1 });
    try {
      const now = "2026-10-07T12:00:00.000Z";
      const bot = { messenger: "telegram", botId: "bot1" } as const;
      const update = { key: "u1", chat: { id: "100", type: "private" }, kind: "text", text: "при\u0000вет", files: [{ fileId: "f\u00001" }] };
      expect(await store.claimUpdate("u1", now, { ...bot, update, holder: "a", leaseUntil: now })).toBe(true);
      const [taken] = await store.takeAbandonedUpdates(bot, "b", now, now, 10);
      expect(taken?.update).toEqual({ ...update, text: "привет", files: [{ fileId: "f1" }] });

      await store.saveLink({ ...bot, externalUserId: "100", userId: "anna", name: "Ан\u0000на", username: "an\u0000na", linkedAt: now });
      expect(await store.findLink("telegram", "bot1", "100")).toMatchObject({ name: "Анна", username: "anna" });

      const key = { ...bot, externalChatId: "100" };
      await store.savePendingDelivery({ ...key, id: "d1", chat: { id: "100", type: "private" }, message: { text: "ито\u0000г", markup: "plain" }, createdAt: now }, "a", now);
      const [delivery] = await store.takeAbandonedDeliveries(bot, "b", now, now, 10);
      expect(delivery?.message.text).toBe("итог");

      await store.saveButton({ ...key, id: "btn1", action: { type: "reply", text: "да\u0000" }, createdAt: now });
      expect(await store.takeButton(key, "btn1", now)).toEqual({ type: "reply", text: "да" });
    } finally {
      await store.close?.();
    }
  });

  it("у разговоров есть индекс по чату агента: поиск разговоров чата не просматривает всю таблицу", async () => {
    const database = await freshDatabase();
    const store = await createPostgresMessengerStore({ connectionString: database.connectionString, poolSize: 1 });
    await store.close?.();
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const rows = (await client.query("select indexdef from pg_indexes where schemaname = 'agent_chat' and tablename = 'messenger_conversations'")).rows.map((row) => row.indexdef as string);
      expect(rows.some((definition) => /\(current_chat_id\)/.test(definition))).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("миграции хранилища чатов и мессенджеров в одной базе — в любом порядке", async () => {
    for (const order of ["storage-first", "messengers-first"] as const) {
      const database = await freshDatabase();
      const openStorage = async () => (await createPostgresChatStorage({ connectionString: database.connectionString, poolSize: 1 })).close();
      const openMessengers = async () => (await createPostgresMessengerStore({ connectionString: database.connectionString, poolSize: 1 })).close?.();
      if (order === "storage-first") {
        await openStorage();
        await openMessengers();
      } else {
        await openMessengers();
        await openStorage();
      }
    }
  });

  it("ошибка подключения не показывает строку подключения", async () => {
    const connectionString = "postgres://user:very-secret-password@127.0.0.1:1/db";
    const failure = await createPostgresMessengerStore({ connectionString, poolSize: 1 }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("very-secret-password");
  });

  it("close() — обязательный у хранилища: закрывает свой пул; повторный вызов не падает", async () => {
    const database = await freshDatabase();
    const store = await createPostgresMessengerStore({ connectionString: database.connectionString, poolSize: 1 });
    const close: () => Promise<void> = store.close;
    await close();
    await expect(store.listLinks("anna")).rejects.toThrow();
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("создание упало после открытия пула — пул закрыт", async () => {
    const end = vi.spyOn(pg.Pool.prototype, "end");
    try {
      await expect(createPostgresMessengerStore({ connectionString: "postgres://user:secret@127.0.0.1:1/db", poolSize: 1 })).rejects.toThrow();
      expect(end).toHaveBeenCalledTimes(1);
    } finally {
      end.mockRestore();
    }
  });

  it("close() во время идущего запроса: запрос доходит, оба вызова close() завершаются", async () => {
    const database = await freshDatabase();
    const store = await createPostgresMessengerStore({ connectionString: database.connectionString, poolSize: 1 });
    const running = store.listLinks("anna");
    // Запрос уже занял соединение пула.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [links] = await Promise.all([running, store.close(), store.close()]);
    expect(links).toEqual([]);
    await expect(store.close()).resolves.toBeUndefined();
  });
});
