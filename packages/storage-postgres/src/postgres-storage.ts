import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createDrizzleChatStorage, storageSchema } from "./drizzle-chat-storage";
import { migrateToLatest } from "./migrate";

export interface PostgresChatStorage extends ChatStorage {
  /** Закрывает соединения с базой. */
  close(): Promise<void>;
}

export interface PostgresChatStorageOptions {
  /** Например `postgres://user:password@host:5432/database`. */
  connectionString: string;
  /** Сколько соединений держать открытыми. По умолчанию 10. */
  poolSize?: number;
  /** Журнал сервера: обрывы соединения. По умолчанию `console.error`. */
  logError?: (message: string) => void;
}

const DEFAULT_POOL_SIZE = 10;

/**
 * Хранилище в PostgreSQL. Таблицы лежат в схеме `agent_chat`; схема приводится к последней
 * миграции при создании, под блокировкой базы.
 */
export async function createPostgresChatStorage(options: PostgresChatStorageOptions): Promise<PostgresChatStorage> {
  const logError = options.logError ?? ((message: string) => console.error(message));
  const pool = new pg.Pool({ connectionString: options.connectionString, max: options.poolSize ?? DEFAULT_POOL_SIZE });
  // Без обработчика оборвавшееся соединение простаивающего пула роняет процесс.
  pool.on("error", (error) => logError(`PostgreSQL: соединение оборвалось: ${error.message}`));
  try {
    await pool.query("select 1");
  } catch (error) {
    await pool.end().catch(() => {});
    throw failure("Не удалось подключиться к PostgreSQL", options.connectionString, error);
  }
  try {
    await migrateToLatest(pool);
  } catch (error) {
    await pool.end().catch(() => {});
    throw failure("Не удалось применить миграции PostgreSQL", options.connectionString, error);
  }
  return {
    ...createDrizzleChatStorage(drizzle(pool, { schema: storageSchema })),
    async close() {
      await pool.end();
    },
  };
}

/** Ошибка без строки подключения: хост, порт и база берутся из разобранного адреса, пароль в текст не попадает. */
function failure(summary: string, connectionString: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  let place = "адрес не разобран";
  try {
    const address = new URL(connectionString);
    place = `${address.hostname}:${address.port || "5432"}${address.pathname}`;
  } catch {
    // Адрес не разобрать — в текст ошибки он не попадает.
  }
  const safeReason = reason.split(connectionString).join("<строка подключения>");
  return new Error(`${summary} (${place}): ${safeReason}`);
}
