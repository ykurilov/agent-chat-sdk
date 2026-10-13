import { fileURLToPath } from "node:url";
import pg from "pg";
import type { JournalOptions } from "./journal/journal";
import { createSandboxJournal } from "./journal/journal";
import { createPostgresJournalStore, migrateJournalToLatest } from "./journal/postgres-journal";
import type { SandboxJournal } from "./types";

export type { LogError, SandboxJournal } from "./types";

export type PostgresSandboxJournalOptions = JournalOptions & {
  /** Например `postgres://user:password@host:5432/database`; та же база, что у `createPostgresChatStorage`. */
  connectionString: string;
  /** Сколько соединений держать открытыми. По умолчанию 5. */
  poolSize?: number;
};

const DEFAULT_POOL_SIZE = 5;
const migrationsFolder = fileURLToPath(new URL("../drizzle/postgres", import.meta.url));

/**
 * Журнал песочницы в PostgreSQL. Таблицы лежат в схеме `agent_chat`; схема приводится
 * к последней миграции при создании, под блокировкой базы.
 */
export async function createPostgresSandboxJournal(options: PostgresSandboxJournalOptions): Promise<SandboxJournal> {
  const logError = options.logError ?? ((message: string) => console.error(message));
  const pool = new pg.Pool({ connectionString: options.connectionString, max: options.poolSize ?? DEFAULT_POOL_SIZE });
  // Без обработчика оборвавшееся соединение простаивающего пула роняет процесс.
  pool.on("error", (error) => logError(`журнал песочницы: соединение с PostgreSQL оборвалось: ${error.message}`));
  try {
    await migrateJournalToLatest(pool, migrationsFolder);
  } catch (error) {
    await pool.end().catch(() => {});
    throw failure(error, options.connectionString);
  }
  return createSandboxJournal(createPostgresJournalStore(pool), { ...options, logError });
}

/** Ошибка без строки подключения: пароль в текст не попадает. */
function failure(cause: unknown, connectionString: string): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Не удалось подготовить журнал песочницы в PostgreSQL: ${reason.split(connectionString).join("<строка подключения>")}`);
}
