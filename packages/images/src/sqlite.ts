import { fileURLToPath } from "node:url";
import type { ImageJobStore } from "./image-queue/image-job-store";
import { createSqliteImageJobStore } from "./image-queue/sqlite-image-job-store";

export { IMAGE_JOBS_MIGRATIONS_TABLE } from "./image-queue/migration-settings";
export { imageJobs } from "./image-queue/sqlite-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/sqlite`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/sqlite", import.meta.url));

/**
 * Задачи картинок в файле SQLite; файл может быть общим с хранилищем чатов (`createSqliteChatStorage`).
 * Таблица приводится к последней миграции при открытии.
 */
export function sqliteImageJobStore(filePath: string): ImageJobStore {
  return createSqliteImageJobStore(filePath, MIGRATIONS_FOLDER);
}
