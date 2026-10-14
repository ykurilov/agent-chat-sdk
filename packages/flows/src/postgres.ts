import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { createPostgresFlowStore, type PostgresFlowStore } from "./store/postgres";

export type { PostgresFlowStore } from "./store/postgres";
export { FLOWS_MIGRATIONS_TABLE, FLOWS_MIGRATION_LOCK_KEY } from "./store/migration-settings";
export { flowChats, flowClientCards, flowFirstMessages, flowVersions } from "./store/postgres-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/postgres`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/postgres", import.meta.url));

/**
 * Сценарии в PostgreSQL на пуле приложения (схема `agent_chat`, та же база, что у хранилища чатов).
 * Таблицы приводятся к последней миграции при первом обращении. Пул закрывает приложение.
 */
export function postgresFlowStore(pool: Pool): PostgresFlowStore {
  return createPostgresFlowStore(pool, MIGRATIONS_FOLDER);
}
