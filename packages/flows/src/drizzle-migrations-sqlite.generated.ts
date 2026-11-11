// Создано scripts/embed-migrations.mjs из packages/flows/drizzle/sqlite; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1791881546227, hash: "6185033c4e9842e22c4cc9e6c969cb4e085737717b8173be08a68ef10abcae67", bps: true, sql: [
    "CREATE TABLE `flow_chats` (\n\t`chat_id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`flow_id` text NOT NULL,\n\t`version_id` text NOT NULL,\n\t`state_id` text NOT NULL,\n\t`pending` text DEFAULT '[]' NOT NULL,\n\t`due_at` integer,\n\t`due_exit_id` text,\n\t`due_branch_head` text,\n\t`time_zone` text NOT NULL,\n\t`lease_until` integer,\n\t`lease_owner` text,\n\t`updated_at` integer NOT NULL\n);\n",
    "\nCREATE INDEX `flow_chats_due_idx` ON `flow_chats` (`due_at`);",
    "\nCREATE INDEX `flow_chats_flow_state_idx` ON `flow_chats` (`flow_id`,`version_id`,`state_id`);",
    "\nCREATE INDEX `flow_chats_owner_idx` ON `flow_chats` (`owner_id`);",
    "\nCREATE TABLE `flow_client_cards` (\n\t`owner_id` text NOT NULL,\n\t`field_id` text NOT NULL,\n\t`value` text NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`flow_id` text NOT NULL,\n\tPRIMARY KEY(`owner_id`, `field_id`)\n);\n",
    "\nCREATE TABLE `flow_first_messages` (\n\t`owner_id` text NOT NULL,\n\t`day` text NOT NULL,\n\t`count` integer DEFAULT 0 NOT NULL,\n\tPRIMARY KEY(`owner_id`, `day`)\n);\n",
    "\nCREATE TABLE `flow_versions` (\n\t`flow_id` text NOT NULL,\n\t`version_id` text NOT NULL,\n\t`hash` text NOT NULL,\n\t`flow` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\tPRIMARY KEY(`flow_id`, `version_id`)\n);\n",
  ] },
  // 0001_days_pause_side_tasks
  { folderMillis: 1791943330845, hash: "25f2d1627345a8b3e496449f1799478fcb4ce1329df80a52a3aee49bd3ac8159", bps: true, sql: [
    "CREATE TABLE `flow_people` (\n\t`owner_id` text PRIMARY KEY NOT NULL,\n\t`time_zone` text NOT NULL,\n\t`updated_at` integer NOT NULL\n);\n",
    "\nCREATE TABLE `flow_side_tasks` (\n\t`owner_id` text NOT NULL,\n\t`task_id` text NOT NULL,\n\t`chat_id` text DEFAULT '' NOT NULL,\n\t`asks` integer DEFAULT 0 NOT NULL,\n\t`done_at` integer,\n\tPRIMARY KEY(`owner_id`, `task_id`, `chat_id`)\n);\n",
    "\nALTER TABLE `flow_chats` ADD `ended_at` integer;",
    "\nALTER TABLE `flow_chats` ADD `end_reason` text;",
    "\nALTER TABLE `flow_chats` ADD `paused_until` integer;",
    "\nALTER TABLE `flow_chats` ADD `window_closed` integer DEFAULT false NOT NULL;",
    "\nALTER TABLE `flow_chats` ADD `day_closed_on` text;",
    "\nALTER TABLE `flow_chats` ADD `delivery` text;",
  ] },
  // 0002_chat_placement
  { folderMillis: 1791945773639, hash: "2cba06ee8cc8690d58323cec8bce3056e2d0687bd29d53845292c4c0c6c6b310", bps: true, sql: [
    "ALTER TABLE `flow_chats` ADD `placement` text;",
  ] },
  // 0003_chat_reopen
  { folderMillis: 1792408865304, hash: "caae1194ddbb43ef5b83d9dad1169c6b33e556a4e2c754492affa4a8700468e9", bps: true, sql: [
    "ALTER TABLE `flow_chats` ADD `reopened_at` integer;",
  ] },
  // 0004_transition_mode
  { folderMillis: 1793174400000, hash: "b36be9d5fa31f6be84b7e6cdf19343a6745815e427c1f35d50b8f7eb2948a5d1", bps: true, sql: [
    "ALTER TABLE \"flow_chats\" ADD COLUMN \"transition_mode\" text NOT NULL DEFAULT 'rails';\n",
  ] },
  // 0005_first_message_holds
  { folderMillis: 1794323045755, hash: "610b7262512264fc2ed42966dcadda9577e33f4088af831c877b53f945abef99", bps: true, sql: [
    "CREATE TABLE `flow_first_message_holds` (\n\t`owner_id` text NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`day` text NOT NULL,\n\t`until` integer NOT NULL,\n\tPRIMARY KEY(`owner_id`, `chat_id`)\n);\n",
  ] },
];
