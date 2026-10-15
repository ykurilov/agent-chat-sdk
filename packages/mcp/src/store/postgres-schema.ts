import { bigint, boolean, index, integer, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Та же схема базы, что у хранилища чатов: у приложения одна база и одна схема `agent_chat`. */
const agentChatSchema = pgSchema("agent_chat");

const moment = (name: string) => timestamp(name, { mode: "date", precision: 3, withTimezone: true });

/**
 * Серверы MCP. Снимок инструментов и настройки — JSON-текстом, не `jsonb`: `jsonb` переставляет ключи, а от порядка
 * ключей схемы зависит кэш модели.
 */
export const mcpServers = agentChatSchema.table(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    status: text("status").notNull(),
    transport: text("transport").notNull(),
    viaProxy: boolean("via_proxy").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    secretUrl: text("secret_url").notNull(),
    displayUrl: text("display_url").notNull(),
    urlHasHiddenParts: boolean("url_has_hidden_parts").notNull(),
    secretHeaders: text("secret_headers"),
    headerNames: text("header_names").notNull(),
    tools: text("tools").notNull(),
    toolsUpdatedAt: moment("tools_updated_at"),
    toolSettings: text("tool_settings").notNull(),
    lastCheck: text("last_check"),
    createdAt: moment("created_at").notNull(),
    updatedAt: moment("updated_at").notNull(),
  },
  (table) => [uniqueIndex("mcp_servers_prefix_idx").on(table.prefix)],
);

/** Журнал вызовов: без входа и результата. */
export const mcpCalls = agentChatSchema.table(
  "mcp_calls",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    toolName: text("tool_name").notNull(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    startedAt: moment("started_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    ok: boolean("ok").notNull(),
    error: text("error"),
  },
  (table) => [index("mcp_calls_started_idx").on(table.startedAt), index("mcp_calls_server_started_idx").on(table.serverId, table.startedAt)],
);

/** Отметка версии серверов: одна строка, число растёт при каждой записи и удалении сервера. */
export const mcpRevision = agentChatSchema.table("mcp_revision", {
  id: integer("id").primaryKey(),
  revision: bigint("revision", { mode: "number" }).notNull(),
});
