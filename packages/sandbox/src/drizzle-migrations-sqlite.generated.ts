// Создано scripts/embed-migrations.mjs из packages/sandbox/drizzle/sqlite; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_journal_init
  { folderMillis: 1791041535561, hash: "f32a0634b1a1856ba157e10ccb34f8b0b5799487d069e5536ed391d2daeae10c", bps: true, sql: [
    "CREATE TABLE `sandbox_answer_edits` (\n\t`message_id` text PRIMARY KEY NOT NULL,\n\t`source_message_id` text NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`text_edited` integer NOT NULL,\n\t`edited_tool_call_ids` text NOT NULL,\n\t`edited_by` text NOT NULL,\n\t`edited_at` integer NOT NULL\n);\n",
    "\nCREATE INDEX `sandbox_answer_edits_chat_idx` ON `sandbox_answer_edits` (`chat_id`,`edited_at`);",
    "\nCREATE TABLE `sandbox_blob_refs` (\n\t`call_id` text NOT NULL,\n\t`hash` text NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`owner_id` text NOT NULL\n);\n",
    "\nCREATE INDEX `sandbox_blob_refs_call_idx` ON `sandbox_blob_refs` (`call_id`);",
    "\nCREATE INDEX `sandbox_blob_refs_hash_idx` ON `sandbox_blob_refs` (`hash`,`owner_id`);",
    "\nCREATE INDEX `sandbox_blob_refs_chat_idx` ON `sandbox_blob_refs` (`chat_id`);",
    "\nCREATE TABLE `sandbox_blobs` (\n\t`hash` text PRIMARY KEY NOT NULL,\n\t`data` blob NOT NULL,\n\t`bytes` integer NOT NULL,\n\t`truncated` integer NOT NULL\n);\n",
    "\nCREATE TABLE `sandbox_model_calls` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`message_id` text,\n\t`purpose` text NOT NULL,\n\t`attempt` integer NOT NULL,\n\t`model_id` text NOT NULL,\n\t`provider_id` text NOT NULL,\n\t`usage` text,\n\t`cost_usd` real,\n\t`started_at` integer NOT NULL,\n\t`first_chunk_ms` integer,\n\t`duration_ms` integer NOT NULL,\n\t`status` text NOT NULL,\n\t`error` text,\n\t`instructions_hash` text NOT NULL,\n\t`message_hashes` text NOT NULL,\n\t`tools_hash` text NOT NULL,\n\t`settings_hash` text NOT NULL,\n\t`response_hash` text NOT NULL,\n\t`tool_call_ids` text NOT NULL\n);\n",
    "\nCREATE INDEX `sandbox_model_calls_chat_idx` ON `sandbox_model_calls` (`chat_id`,`started_at`);",
    "\nCREATE INDEX `sandbox_model_calls_started_idx` ON `sandbox_model_calls` (`started_at`);",
    "\nCREATE TABLE `sandbox_settings` (\n\t`chat_id` text PRIMARY KEY NOT NULL,\n\t`instructions` text,\n\t`updated_by` text NOT NULL,\n\t`updated_at` integer NOT NULL\n);\n",
    "\nCREATE TABLE `sandbox_tool_calls` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`message_id` text NOT NULL,\n\t`tool_call_id` text NOT NULL,\n\t`tool_name` text NOT NULL,\n\t`input_hash` text NOT NULL,\n\t`output_hash` text,\n\t`error` text,\n\t`started_at` integer NOT NULL,\n\t`duration_ms` integer NOT NULL\n);\n",
    "\nCREATE INDEX `sandbox_tool_calls_chat_idx` ON `sandbox_tool_calls` (`chat_id`,`started_at`);",
    "\nCREATE INDEX `sandbox_tool_calls_started_idx` ON `sandbox_tool_calls` (`started_at`);",
  ] },
];
