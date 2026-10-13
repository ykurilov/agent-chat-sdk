import { fileURLToPath } from "node:url";
import type { TaskStore } from "./types";
import { createSqliteTaskStore } from "./store/sqlite";

export { BACKGROUND_MIGRATIONS_TABLE } from "./store/migration-settings";
export { backgroundTasks } from "./store/sqlite-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/sqlite`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/sqlite", import.meta.url));

/**
 * Задачи фона в файле SQLite; файл может быть общим с хранилищем чатов (`createSqliteChatStorage`).
 * Таблица приводится к последней миграции при открытии.
 */
export function sqliteTaskStore(filePath: string): TaskStore {
  return createSqliteTaskStore(filePath, MIGRATIONS_FOLDER);
}
