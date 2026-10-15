import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { createPostgresStore } from "./store/postgres-store";
import type { McpStore } from "./types";

export { MCP_MIGRATION_LOCK_KEY, MCP_MIGRATIONS_TABLE } from "./store/migration-settings";
export { mcpCalls, mcpServers } from "./store/postgres-schema";

/** Миграции лежат в пакете рядом с `dist`: `drizzle/postgres`. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/postgres", import.meta.url));

/** Серверы MCP и журнал вызовов в PostgreSQL на пуле приложения (схема `agent_chat`). Пул закрывает приложение. */
export function createPostgresMcpStore(options: { pool: Pool }): McpStore {
  return createPostgresStore(options.pool, MIGRATIONS_FOLDER);
}
