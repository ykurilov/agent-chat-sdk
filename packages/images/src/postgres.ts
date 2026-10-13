import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type { ImageJobStore } from "./image-queue/image-job-store";
import { createPostgresImageJobStore } from "./image-queue/postgres-image-job-store";

export { IMAGE_JOBS_MIGRATION_LOCK_KEY, IMAGE_JOBS_MIGRATIONS_TABLE } from "./image-queue/migration-settings";
export { imageJobs } from "./image-queue/postgres-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/postgres`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/postgres", import.meta.url));

/**
 * Задачи картинок в PostgreSQL на пуле приложения (схема `agent_chat`, та же база, что у хранилища чатов).
 * Таблица приводится к последней миграции при первом обращении. Пул закрывает приложение.
 */
export function postgresImageJobStore(pool: Pool): ImageJobStore {
  return createPostgresImageJobStore(pool, MIGRATIONS_FOLDER);
}
