import { describe, expect, it } from "vitest";
import { migratePostgresSchema } from "../../../src/storage/postgres-migrations";

const SCHEMA_LOCK = 7_311_900_441;
const OWN_LOCK = 7_311_900_448;

/** Поддельная база: записывает запросы по порядку; схема «есть» после `create schema`. */
function fakeDatabase(options: { schemaExists?: boolean } = {}) {
  let schemaExists = options.schemaExists ?? false;
  const log: string[] = [];
  let released = 0;
  return {
    log,
    released: () => released,
    async connect() {
      return {
        async query(text: string, values?: unknown[]) {
          log.push(values?.length ? `${text} ${values.join(",")}` : text);
          if (text.startsWith("select 1 from pg_namespace")) return { rows: schemaExists ? [{}] : [] };
          if (text.startsWith("create schema")) schemaExists = true;
          return { rows: [] };
        },
        release() {
          released++;
        },
      };
    },
  };
}

/** Ошибка, как её отдаёт drizzle: своя обёртка, код PostgreSQL — в причине. */
function wrappedPgError(code: string) {
  return new Error("Failed query: CREATE SCHEMA IF NOT EXISTS \"agent_chat\"", { cause: Object.assign(new Error("duplicate key value"), { code }) });
}

describe("миграции PostgreSQL на общей схеме", () => {
  it("пустая база: схема под общей блокировкой, общая отпущена до своей, миграции под своей", async () => {
    const db = fakeDatabase();
    await migratePostgresSchema({ connect: db.connect, lockKey: OWN_LOCK, migrate: async (connection) => void (await connection.query("migrate")) });
    expect(db.log).toEqual([
      "select 1 from pg_namespace where nspname = $1 agent_chat",
      `select pg_advisory_lock($1) ${SCHEMA_LOCK}`,
      'create schema if not exists "agent_chat"',
      `select pg_advisory_unlock($1) ${SCHEMA_LOCK}`,
      `select pg_advisory_lock($1) ${OWN_LOCK}`,
      "migrate",
      `select pg_advisory_unlock($1) ${OWN_LOCK}`,
    ]);
    expect(db.released()).toBe(1);
  });

  it("схема уже есть — общая блокировка не берётся, пакеты друг друга не ждут", async () => {
    const db = fakeDatabase({ schemaExists: true });
    await migratePostgresSchema({ connect: db.connect, lockKey: OWN_LOCK, migrate: async () => {} });
    expect(db.log.some((line) => line.includes(String(SCHEMA_LOCK)))).toBe(false);
  });

  it("сосед создал то же одновременно («уже есть») — повтор на новом соединении", async () => {
    const db = fakeDatabase();
    let calls = 0;
    await migratePostgresSchema({ connect: db.connect,
      lockKey: OWN_LOCK,
      retryDelaysMs: [0, 0],
      migrate: async () => {
        calls++;
        if (calls === 1) throw wrappedPgError("23505");
        if (calls === 2) throw Object.assign(new Error("relation already exists"), { code: "42P07" });
      },
    });
    expect(calls).toBe(3);
    expect(db.released()).toBe(3);
    // Своя блокировка отпущена и после неудачной попытки.
    expect(db.log.filter((line) => line === `select pg_advisory_unlock($1) ${OWN_LOCK}`)).toHaveLength(3);
  });

  it("другая ошибка — без повтора; «уже есть» дольше всех повторов — ошибка наружу", async () => {
    const broken = fakeDatabase();
    let calls = 0;
    const syntax = Object.assign(new Error("syntax error"), { code: "42601" });
    await expect(migratePostgresSchema({ connect: broken.connect, lockKey: OWN_LOCK, retryDelaysMs: [0], migrate: async () => {
      calls++;
      throw syntax;
    } })).rejects.toBe(syntax);
    expect(calls).toBe(1);

    const stubborn = fakeDatabase();
    await expect(migratePostgresSchema({ connect: stubborn.connect, lockKey: OWN_LOCK, retryDelaysMs: [0, 0], migrate: () => Promise.reject(wrappedPgError("42P06")) })).rejects.toThrow(/Failed query/);
    expect(stubborn.released()).toBe(3);
  });
});
