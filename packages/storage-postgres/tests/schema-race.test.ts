import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { postgresTaskStore } from "../../background/src/postgres";
import { postgresFlowStore } from "../../flows/src/postgres";
import { postgresImageJobStore } from "../../images/src/postgres";
import { createPostgresMcpStore } from "../../mcp/src/postgres";
import { createPostgresMessengerStore } from "../../messengers/src/postgres";
import { createPostgresSandboxJournal } from "../../sandbox/src/postgres";
import { postgresSkillStore } from "../../skills/src/postgres";
import { createPostgresChatStorage } from "../src/postgres-storage";
import { startTemporaryPostgres } from "./support/pglite-server";
import type { TemporaryPostgres } from "./support/pglite-server";
import { assertSafeToWipe } from "./support/wipe-guard";

/** Хранилище пакета, открытое и дождавшееся своих миграций. */
interface OpenedStore {
  close(): Promise<void>;
}

/** Хранилища, которые открывают свой пул: каждое при открытии создаёт схему `agent_chat` и свои таблицы. */
const ownPoolOpeners: Record<string, (connectionString: string) => Promise<OpenedStore>> = {
  chats: (connectionString) => createPostgresChatStorage({ connectionString, poolSize: 2, logError: () => {} }),
  sandbox: (connectionString) => createPostgresSandboxJournal({ connectionString, poolSize: 2, logError: () => {} }),
  messengers: (connectionString) => createPostgresMessengerStore({ connectionString, poolSize: 2, logError: () => {} }),
};

/** Хранилища на пуле приложения: открыто, когда первая операция дождалась миграций. */
const appPoolOpeners: Record<string, (pool: pg.Pool) => Promise<unknown>> = {
  skills: (pool) => postgresSkillStore(pool).list(),
  mcp: (pool) => createPostgresMcpStore({ pool }).listServers(),
  background: (pool) => postgresTaskStore(pool).listForChat("anna", "chat-1"),
  flows: (pool) => postgresFlowStore(pool).getChat("chat-1"),
  images: (pool) => postgresImageJobStore(pool).list({}),
};

async function onOwnAppPool(connectionString: string, firstOperation: (pool: pg.Pool) => Promise<unknown>): Promise<OpenedStore> {
  const pool = new pg.Pool({ connectionString, max: 2 });
  try {
    await firstOperation(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return { close: () => pool.end() };
}

/** Итог открытия: упавшие — по имени пакета, чтобы сразу видеть, кто проиграл гонку. */
function outcome(names: string[], results: PromiseSettledResult<OpenedStore | unknown>[]) {
  const opened = results.flatMap((result) => (result.status === "fulfilled" && isOpened(result.value) ? [result.value] : []));
  const failed = results.flatMap((result, index) => (result.status === "rejected" ? [`${names[index]}: ${String(result.reason?.message ?? result.reason)}`] : []));
  return { opened, failed };
}

const isOpened = (value: unknown): value is OpenedStore => typeof (value as OpenedStore | undefined)?.close === "function";

/** Все хранилища разом, у каждого свои соединения: так стартуют серверы приложения на настоящем PostgreSQL. */
async function openAllAtOnce(connectionString: string) {
  const names = [...Object.keys(ownPoolOpeners), ...Object.keys(appPoolOpeners)];
  const results = await Promise.allSettled([
    ...Object.values(ownPoolOpeners).map((open) => open(connectionString)),
    ...Object.values(appPoolOpeners).map((first) => onOwnAppPool(connectionString, first)),
  ]);
  return outcome(names, results);
}

/**
 * pglite: сервер сокета перемешивает сообщения разных подключений, одновременные запросы с нескольких соединений его
 * ломают. Поэтому хранилища на пуле приложения открываются разом на общем пуле с одним соединением, а со своим
 * пулом — по очереди. Одновременный старт по-настоящему проверяет прогон на настоящем PostgreSQL ниже.
 */
async function openAllOnPglite(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const shared = await Promise.allSettled(Object.values(appPoolOpeners).map((first) => first(pool)));
  const own: PromiseSettledResult<OpenedStore>[] = [];
  for (const open of Object.values(ownPoolOpeners)) own.push(...(await Promise.allSettled([open(connectionString)])));
  const result = outcome([...Object.keys(appPoolOpeners), ...Object.keys(ownPoolOpeners)], [...shared, ...own]);
  return { opened: [...result.opened, { close: () => pool.end() }], failed: result.failed };
}

async function closeAll(stores: OpenedStore[]): Promise<void> {
  await Promise.all(stores.map((store) => store.close()));
}

describe("хранилища всех пакетов стартуют одновременно на пустой базе", () => {
  const databases: TemporaryPostgres[] = [];
  afterEach(async () => {
    for (const database of databases.splice(0)) await database.stop();
  });

  it("pglite: все открываются, повторное открытие — тоже", async () => {
    // Закрытые подключения сервер сокета отцепляет не сразу: повторному открытию нужны свободные места.
    const database = await startTemporaryPostgres({ maxConnections: 16 });
    databases.push(database);
    const first = await openAllOnPglite(database.connectionString);
    await closeAll(first.opened);
    expect(first.failed).toEqual([]);
    const again = await openAllOnPglite(database.connectionString);
    await closeAll(again.opened);
    expect(again.failed).toEqual([]);
  }, 60_000);
});

/**
 * Настоящий PostgreSQL: гонку за схему `agent_chat` видно только на нескольких соединениях (pglite склеивает их в
 * одно). Включается переменной `AGENT_CHAT_TEST_POSTGRES_URL`; схема в этой базе стирается (см. `support/wipe-guard.ts`).
 */
const realPostgresUrl = process.env.AGENT_CHAT_TEST_POSTGRES_URL;

describe.skipIf(!realPostgresUrl)("хранилища всех пакетов стартуют одновременно (настоящий PostgreSQL)", () => {
  if (realPostgresUrl) assertSafeToWipe(realPostgresUrl);

  async function dropSchema(): Promise<void> {
    const client = new pg.Client({ connectionString: realPostgresUrl });
    await client.connect();
    try {
      await client.query("drop schema if exists agent_chat cascade");
    } finally {
      await client.end();
    }
  }

  afterEach(dropSchema);

  it("на пустой базе все открываются (15 повторов), повторное открытие — тоже", async () => {
    for (let round = 0; round < 15; round++) {
      await dropSchema();
      const first = await openAllAtOnce(realPostgresUrl!);
      await closeAll(first.opened);
      expect({ round, failed: first.failed }).toEqual({ round, failed: [] });
    }
    const again = await openAllAtOnce(realPostgresUrl!);
    await closeAll(again.opened);
    expect(again.failed).toEqual([]);
  }, 180_000);
});
