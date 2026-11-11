import type { Pool } from "pg";
import { createPostgresFlowStore, type PostgresFlowStore } from "./store/postgres";
import { migrations } from "./drizzle-migrations-postgres.generated";

export type { PostgresFlowStore } from "./store/postgres";
export { FLOWS_MIGRATIONS_TABLE, FLOWS_MIGRATION_LOCK_KEY } from "./store/migration-settings";
export { flowChats, flowClientCards, flowFirstMessages, flowVersions } from "./store/postgres-schema";


/**
 * Сценарии в PostgreSQL на пуле приложения (схема `agent_chat`, та же база, что у хранилища чатов).
 * Таблицы приводятся к последней миграции при первом обращении. Пул закрывает приложение.
 */
export function postgresFlowStore(pool: Pool): PostgresFlowStore {
  return createPostgresFlowStore(pool, migrations);
}
