import { createSqliteFlowStore, type SqliteFlowStore } from "./store/sqlite";
import { migrations } from "./drizzle-migrations-sqlite.generated";

export type { SqliteFlowStore } from "./store/sqlite";
export { FLOWS_MIGRATIONS_TABLE } from "./store/migration-settings";
export { flowChats, flowClientCards, flowFirstMessages, flowVersions } from "./store/sqlite-schema";


/**
 * Сценарии в файле SQLite; файл может быть общим с хранилищем чатов (`createSqliteChatStorage`).
 * Таблицы приводятся к последней миграции при открытии.
 */
export function sqliteFlowStore(filePath: string): SqliteFlowStore {
  return createSqliteFlowStore(filePath, migrations);
}
