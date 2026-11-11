import { createSqliteStore } from "./store/sqlite-store";
import type { McpStore } from "./types";
import { migrations } from "./drizzle-migrations-sqlite.generated";

export { MCP_MIGRATIONS_TABLE } from "./store/migration-settings";
export { mcpCalls, mcpServers } from "./store/sqlite-schema";


/** Серверы MCP и журнал вызовов в файле SQLite; файл может быть общим с хранилищем чатов. */
export function createSqliteMcpStore(options: { filePath: string }): McpStore & { close(): void } {
  return createSqliteStore(options.filePath, migrations);
}
