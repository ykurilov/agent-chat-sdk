import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Серверы MCP. Снимок инструментов и настройки — JSON-текстом: порядок ключей схемы сохраняется байт в байт,
 * от него зависит кэш модели.
 */
export const mcpServers = sqliteTable(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    status: text("status").notNull(),
    transport: text("transport").notNull(),
    viaProxy: integer("via_proxy", { mode: "boolean" }).notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    secretUrl: text("secret_url").notNull(),
    displayUrl: text("display_url").notNull(),
    urlHasHiddenParts: integer("url_has_hidden_parts", { mode: "boolean" }).notNull(),
    secretHeaders: text("secret_headers"),
    headerNames: text("header_names").notNull(),
    tools: text("tools").notNull(),
    toolsUpdatedAt: integer("tools_updated_at"),
    toolSettings: text("tool_settings").notNull(),
    lastCheck: text("last_check"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("mcp_servers_prefix_idx").on(table.prefix)],
);

/** Журнал вызовов: без входа и результата. */
export const mcpCalls = sqliteTable(
  "mcp_calls",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    toolName: text("tool_name").notNull(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    startedAt: integer("started_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
  },
  (table) => [index("mcp_calls_started_idx").on(table.startedAt), index("mcp_calls_server_started_idx").on(table.serverId, table.startedAt)],
);

/** Отметка версии серверов: одна строка, число растёт при каждой записи и удалении сервера. */
export const mcpRevision = sqliteTable("mcp_revision", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull(),
});
