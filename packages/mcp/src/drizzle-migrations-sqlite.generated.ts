// Создано scripts/embed-migrations.mjs из packages/mcp/drizzle/sqlite; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1792011700488, hash: "308e4491dea5fdef49a310bbf32e8567ebd3fc925fc79e84d0de044261172f91", bps: true, sql: [
    "CREATE TABLE `mcp_calls` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`server_id` text NOT NULL,\n\t`tool_name` text NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`started_at` integer NOT NULL,\n\t`duration_ms` integer NOT NULL,\n\t`ok` integer NOT NULL,\n\t`error` text\n);\n",
    "\nCREATE INDEX `mcp_calls_started_idx` ON `mcp_calls` (`started_at`);",
    "\nCREATE INDEX `mcp_calls_server_started_idx` ON `mcp_calls` (`server_id`,`started_at`);",
    "\nCREATE TABLE `mcp_servers` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`prefix` text NOT NULL,\n\t`status` text NOT NULL,\n\t`transport` text NOT NULL,\n\t`via_proxy` integer NOT NULL,\n\t`timeout_ms` integer NOT NULL,\n\t`secret_url` text NOT NULL,\n\t`display_url` text NOT NULL,\n\t`url_has_hidden_parts` integer NOT NULL,\n\t`secret_headers` text,\n\t`header_names` text NOT NULL,\n\t`tools` text NOT NULL,\n\t`tools_updated_at` integer,\n\t`tool_settings` text NOT NULL,\n\t`last_check` text,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL\n);\n",
    "\nCREATE UNIQUE INDEX `mcp_servers_prefix_idx` ON `mcp_servers` (`prefix`);",
  ] },
  // 0001_revision
  { folderMillis: 1792014040090, hash: "0a7a829c04fb9250281433678db099821efdcde28c58ce220f04e8270e2647f6", bps: true, sql: [
    "CREATE TABLE `mcp_revision` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`revision` integer NOT NULL\n);\n",
  ] },
];
