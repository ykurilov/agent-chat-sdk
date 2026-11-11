// Создано scripts/embed-migrations.mjs из packages/background/drizzle/sqlite; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1791177855567, hash: "20ea5ed839539873fc47293aa89374b95d3d3d64fcf1befa341014aedbd8b1ad", bps: true, sql: [
    "CREATE TABLE `background_tasks` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`message_id` text NOT NULL,\n\t`tool_call_id` text NOT NULL,\n\t`channel` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`name` text NOT NULL,\n\t`input` text,\n\t`title` text NOT NULL,\n\t`status` text NOT NULL,\n\t`helper_messages` text,\n\t`progress` text,\n\t`result` text,\n\t`error` text,\n\t`lease_owner` text,\n\t`lease_until` integer,\n\t`attempt` integer DEFAULT 0 NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`started_at` integer,\n\t`finished_at` integer,\n\t`delivered_at` integer\n);\n",
    "\nCREATE INDEX `background_tasks_status_lease_idx` ON `background_tasks` (`status`,`lease_until`);",
    "\nCREATE INDEX `background_tasks_owner_status_idx` ON `background_tasks` (`owner_id`,`status`);",
    "\nCREATE INDEX `background_tasks_chat_delivered_idx` ON `background_tasks` (`chat_id`,`delivered_at`);",
  ] },
  // 0001_delivery_key
  { folderMillis: 1791184440017, hash: "26d881cb5f9b4e488c4c6746c26fe8e84119ecae851ac613fc685993b1637158", bps: true, sql: [
    "ALTER TABLE `background_tasks` ADD `delivery_key` text;",
  ] },
];
