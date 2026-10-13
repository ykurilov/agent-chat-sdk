import { fileURLToPath } from "node:url";
import pg from "pg";
import { createPostgresMessengerStore as openPostgresMessengerStore, migrateMessengersToLatest } from "./store/postgres-store";
import type { ClosableMessengerStore } from "./types";

export { MESSENGERS_MIGRATIONS_TABLE, MESSENGERS_MIGRATION_LOCK_KEY } from "./store/migration-settings";
export * from "./store/postgres-schema";
export type { ClosableMessengerStore, MessengerStore } from "./types";

const DEFAULT_POOL_SIZE = 5;
const migrationsFolder = fileURLToPath(new URL("../drizzle/postgres", import.meta.url));

export interface PostgresMessengerStoreOptions {
  /** Например `postgres://user:password@host:5432/database`; та же база, что у `createPostgresChatStorage`. */
  connectionString: string;
  /** Сколько соединений держать открытыми. По умолчанию 5. */
  poolSize?: number;
  logError?(message: string): void;
}

/**
 * Хранилище мессенджеров в PostgreSQL. Таблицы — в схеме `agent_chat`; схема приводится к последней миграции под блокировкой базы.
 * Пул соединений хранилище открывает само; `close()` его закрывает (зовите при остановке сервера после `messengers.stop()`).
 * Не удалось подготовить хранилище — пул закрывается до ошибки.
 */
export async function createPostgresMessengerStore(options: PostgresMessengerStoreOptions): Promise<ClosableMessengerStore> {
  const logError = options.logError ?? ((message: string) => console.error(message));
  const pool = new pg.Pool({ connectionString: options.connectionString, max: options.poolSize ?? DEFAULT_POOL_SIZE });
  // Без обработчика оборвавшееся соединение простаивающего пула роняет процесс.
  pool.on("error", (error) => logError(`мессенджеры: соединение с PostgreSQL оборвалось: ${error.message}`));
  try {
    await migrateMessengersToLatest(pool, migrationsFolder);
  } catch (error) {
    await pool.end().catch(() => {});
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось подготовить хранилище мессенджеров в PostgreSQL: ${reason.split(options.connectionString).join("<строка подключения>")}`);
  }
  return openPostgresMessengerStore(pool);
}
