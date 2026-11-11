import type { ImageJobStore } from "./image-queue/image-job-store";
import { createSqliteImageJobStore } from "./image-queue/sqlite-image-job-store";
import { migrations } from "./drizzle-migrations-sqlite.generated";

export { IMAGE_JOBS_MIGRATIONS_TABLE } from "./image-queue/migration-settings";
export { imageJobs } from "./image-queue/sqlite-schema";


/**
 * Задачи картинок в файле SQLite; файл может быть общим с хранилищем чатов (`createSqliteChatStorage`).
 * Таблица приводится к последней миграции при открытии.
 */
export function sqliteImageJobStore(filePath: string): ImageJobStore {
  return createSqliteImageJobStore(filePath, migrations);
}
