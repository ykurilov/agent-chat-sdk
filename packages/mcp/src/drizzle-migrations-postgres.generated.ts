// Создано scripts/embed-migrations.mjs из packages/mcp/drizzle/postgres; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1792011700943, hash: "68c7212872124bffab4879e5be653a7370aff497fd66570f25cadfce5f149406", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"mcp_calls\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"server_id\" text NOT NULL,\n\t\"tool_name\" text NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"started_at\" timestamp (3) with time zone NOT NULL,\n\t\"duration_ms\" integer NOT NULL,\n\t\"ok\" boolean NOT NULL,\n\t\"error\" text\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"mcp_servers\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"name\" text NOT NULL,\n\t\"prefix\" text NOT NULL,\n\t\"status\" text NOT NULL,\n\t\"transport\" text NOT NULL,\n\t\"via_proxy\" boolean NOT NULL,\n\t\"timeout_ms\" integer NOT NULL,\n\t\"secret_url\" text NOT NULL,\n\t\"display_url\" text NOT NULL,\n\t\"url_has_hidden_parts\" boolean NOT NULL,\n\t\"secret_headers\" text,\n\t\"header_names\" text NOT NULL,\n\t\"tools\" text NOT NULL,\n\t\"tools_updated_at\" timestamp (3) with time zone,\n\t\"tool_settings\" text NOT NULL,\n\t\"last_check\" text,\n\t\"created_at\" timestamp (3) with time zone NOT NULL,\n\t\"updated_at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE INDEX \"mcp_calls_started_idx\" ON \"agent_chat\".\"mcp_calls\" USING btree (\"started_at\");",
    "\nCREATE INDEX \"mcp_calls_server_started_idx\" ON \"agent_chat\".\"mcp_calls\" USING btree (\"server_id\",\"started_at\");",
    "\nCREATE UNIQUE INDEX \"mcp_servers_prefix_idx\" ON \"agent_chat\".\"mcp_servers\" USING btree (\"prefix\");",
  ] },
  // 0001_revision
  { folderMillis: 1792014040400, hash: "24d97befb33e75ff96c94a38fcb84aba0a75be115b7a9cd1fed90e75a6b343a4", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"mcp_revision\" (\n\t\"id\" integer PRIMARY KEY NOT NULL,\n\t\"revision\" bigint NOT NULL\n);\n",
  ] },
];
