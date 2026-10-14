import { fileURLToPath } from "node:url";
import { createSqliteFlowStore, type SqliteFlowStore } from "./store/sqlite";

export type { SqliteFlowStore } from "./store/sqlite";
export { FLOWS_MIGRATIONS_TABLE } from "./store/migration-settings";
export { flowChats, flowClientCards, flowFirstMessages, flowVersions } from "./store/sqlite-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/sqlite`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/sqlite", import.meta.url));

/**
 * Сценарии в файле SQLite; файл может быть общим с хранилищем чатов (`createSqliteChatStorage`).
 * Таблицы приводятся к последней миграции при открытии.
 */
export function sqliteFlowStore(filePath: string): SqliteFlowStore {
  return createSqliteFlowStore(filePath, MIGRATIONS_FOLDER);
}
