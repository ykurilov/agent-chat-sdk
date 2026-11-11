// Создано scripts/embed-migrations.mjs из packages/messengers/drizzle/sqlite; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1791177856632, hash: "3b1f1a4f83f231193ef0459ac2dba09b23e50d7a787b54d5e9721d97a9507280", bps: true, sql: [
    "CREATE TABLE `messenger_buttons` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`messenger` text NOT NULL,\n\t`bot_id` text NOT NULL,\n\t`external_chat_id` text NOT NULL,\n\t`action` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`used_at` integer\n);\n",
    "\nCREATE INDEX `messenger_buttons_created_idx` ON `messenger_buttons` (`created_at`);",
    "\nCREATE TABLE `messenger_conversations` (\n\t`messenger` text NOT NULL,\n\t`bot_id` text NOT NULL,\n\t`external_chat_id` text NOT NULL,\n\t`type` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`connected_by` text,\n\t`current_chat_id` text,\n\t`blocked` integer DEFAULT false NOT NULL,\n\t`active` integer DEFAULT true NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\tPRIMARY KEY(`messenger`, `bot_id`, `external_chat_id`)\n);\n",
    "\nCREATE INDEX `messenger_conversations_user_idx` ON `messenger_conversations` (`user_id`);",
    "\nCREATE TABLE `messenger_leases` (\n\t`name` text PRIMARY KEY NOT NULL,\n\t`holder` text NOT NULL,\n\t`lease_until` integer NOT NULL\n);\n",
    "\nCREATE TABLE `messenger_link_codes` (\n\t`code_hash` text PRIMARY KEY NOT NULL,\n\t`user_id` text NOT NULL,\n\t`messenger` text NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`used_at` integer\n);\n",
    "\nCREATE INDEX `messenger_link_codes_expires_idx` ON `messenger_link_codes` (`expires_at`);",
    "\nCREATE TABLE `messenger_links` (\n\t`messenger` text NOT NULL,\n\t`bot_id` text NOT NULL,\n\t`external_user_id` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`username` text,\n\t`linked_at` integer NOT NULL,\n\tPRIMARY KEY(`messenger`, `bot_id`, `external_user_id`)\n);\n",
    "\nCREATE INDEX `messenger_links_user_idx` ON `messenger_links` (`user_id`,`messenger`);",
    "\nCREATE TABLE `messenger_member_hits` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`messenger` text NOT NULL,\n\t`bot_id` text NOT NULL,\n\t`external_chat_id` text NOT NULL,\n\t`external_user_id` text NOT NULL,\n\t`at` integer NOT NULL\n);\n",
    "\nCREATE INDEX `messenger_member_hits_member_idx` ON `messenger_member_hits` (`messenger`,`bot_id`,`external_chat_id`,`external_user_id`,`at`);",
    "\nCREATE TABLE `messenger_updates` (\n\t`key` text PRIMARY KEY NOT NULL,\n\t`status` text NOT NULL,\n\t`received_at` integer NOT NULL,\n\t`finished_at` integer\n);\n",
    "\nCREATE INDEX `messenger_updates_received_idx` ON `messenger_updates` (`received_at`);",
  ] },
  // 0001_pending_deliveries
  { folderMillis: 1791186539728, hash: "ad843bc9da840a03f4eb579da6ad7557388d142da05040ffc462bf396a08eccc", bps: true, sql: [
    "CREATE TABLE `messenger_deliveries` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`messenger` text NOT NULL,\n\t`bot_id` text NOT NULL,\n\t`external_chat_id` text NOT NULL,\n\t`payload` text NOT NULL,\n\t`holder` text NOT NULL,\n\t`lease_until` integer NOT NULL,\n\t`created_at` integer NOT NULL\n);\n",
    "\nCREATE INDEX `messenger_deliveries_bot_idx` ON `messenger_deliveries` (`messenger`,`bot_id`,`lease_until`);",
    "\nCREATE INDEX `messenger_deliveries_holder_idx` ON `messenger_deliveries` (`holder`);",
  ] },
  // 0002_conversations_current_chat_idx
  { folderMillis: 1791362487001, hash: "232c2e8bbee1ce0fd655b86e5d0fb527ba4cb9b241c4f2815087483b44612c49", bps: true, sql: [
    "CREATE INDEX `messenger_conversations_current_chat_idx` ON `messenger_conversations` (`current_chat_id`);",
  ] },
  // 0003_inbound_updates_recovery
  { folderMillis: 1791362712061, hash: "2b4297a9e2a87638379616adffb8bc666b2b99593ff7f0191d00e428a8814c8f", bps: true, sql: [
    "ALTER TABLE `messenger_updates` ADD `messenger` text;",
    "\nALTER TABLE `messenger_updates` ADD `bot_id` text;",
    "\nALTER TABLE `messenger_updates` ADD `payload` text;",
    "\nALTER TABLE `messenger_updates` ADD `holder` text;",
    "\nALTER TABLE `messenger_updates` ADD `lease_until` integer;",
    "\nALTER TABLE `messenger_updates` ADD `attempts` integer DEFAULT 0 NOT NULL;",
    "\nCREATE INDEX `messenger_updates_work_idx` ON `messenger_updates` (`messenger`,`bot_id`,`lease_until`);",
  ] },
];
