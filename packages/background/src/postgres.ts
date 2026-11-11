import type { Pool } from "pg";
import type { TaskStore } from "./types";
import { createPostgresTaskStore } from "./store/postgres";
import { migrations } from "./drizzle-migrations-postgres.generated";

export { BACKGROUND_MIGRATIONS_TABLE, BACKGROUND_MIGRATION_LOCK_KEY } from "./store/migration-settings";
export { backgroundTasks } from "./store/postgres-schema";


/**
 * Задачи фона в PostgreSQL на пуле приложения (схема `agent_chat`, та же база, что у хранилища чатов).
 * Таблица приводится к последней миграции при первом обращении. Пул закрывает приложение.
 */
export function postgresTaskStore(pool: Pool): TaskStore {
  return createPostgresTaskStore(pool, migrations);
}
