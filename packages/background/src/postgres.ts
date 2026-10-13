import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type { TaskStore } from "./types";
import { createPostgresTaskStore } from "./store/postgres";

export { BACKGROUND_MIGRATIONS_TABLE, BACKGROUND_MIGRATION_LOCK_KEY } from "./store/migration-settings";
export { backgroundTasks } from "./store/postgres-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/postgres`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/postgres", import.meta.url));

/**
 * Задачи фона в PostgreSQL на пуле приложения (схема `agent_chat`, та же база, что у хранилища чатов).
 * Таблица приводится к последней миграции при первом обращении. Пул закрывает приложение.
 */
export function postgresTaskStore(pool: Pool): TaskStore {
  return createPostgresTaskStore(pool, MIGRATIONS_FOLDER);
}
