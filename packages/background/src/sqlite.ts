import type { TaskStore } from "./types";
import { createSqliteTaskStore } from "./store/sqlite";
import { migrations } from "./drizzle-migrations-sqlite.generated";

export { BACKGROUND_MIGRATIONS_TABLE } from "./store/migration-settings";
export { backgroundTasks } from "./store/sqlite-schema";


/**
 * Задачи фона в файле SQLite; файл может быть общим с хранилищем чатов (`createSqliteChatStorage`).
 * Таблица приводится к последней миграции при открытии.
 */
export function sqliteTaskStore(filePath: string): TaskStore {
  return createSqliteTaskStore(filePath, migrations);
}
