import { fileURLToPath } from "node:url";
import { createSqliteStore } from "./store/sqlite-store";
import type { McpStore } from "./types";

export { MCP_MIGRATIONS_TABLE } from "./store/migration-settings";
export { mcpCalls, mcpServers } from "./store/sqlite-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/sqlite`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/sqlite", import.meta.url));

/** Серверы MCP и журнал вызовов в файле SQLite; файл может быть общим с хранилищем чатов. */
export function createSqliteMcpStore(options: { filePath: string }): McpStore & { close(): void } {
  return createSqliteStore(options.filePath, MIGRATIONS_FOLDER);
}
