// Создано scripts/embed-migrations.mjs из packages/flows/drizzle/postgres; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1791881547478, hash: "42574eb8f0d25bcafe643e1428646bba380fde30f7a5f358fd844fdd0e7d8c9e", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"flow_chats\" (\n\t\"chat_id\" text PRIMARY KEY NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"flow_id\" text NOT NULL,\n\t\"version_id\" text NOT NULL,\n\t\"state_id\" text NOT NULL,\n\t\"pending\" jsonb DEFAULT '[]'::jsonb NOT NULL,\n\t\"due_at\" timestamp (3) with time zone,\n\t\"due_exit_id\" text,\n\t\"due_branch_head\" text,\n\t\"time_zone\" text NOT NULL,\n\t\"lease_until\" timestamp (3) with time zone,\n\t\"lease_owner\" text,\n\t\"updated_at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"flow_client_cards\" (\n\t\"owner_id\" text NOT NULL,\n\t\"field_id\" text NOT NULL,\n\t\"value\" jsonb NOT NULL,\n\t\"updated_at\" timestamp (3) with time zone NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"flow_id\" text NOT NULL,\n\tCONSTRAINT \"flow_client_cards_owner_id_field_id_pk\" PRIMARY KEY(\"owner_id\",\"field_id\")\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"flow_first_messages\" (\n\t\"owner_id\" text NOT NULL,\n\t\"day\" text NOT NULL,\n\t\"count\" integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT \"flow_first_messages_owner_id_day_pk\" PRIMARY KEY(\"owner_id\",\"day\")\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"flow_versions\" (\n\t\"flow_id\" text NOT NULL,\n\t\"version_id\" text NOT NULL,\n\t\"hash\" text NOT NULL,\n\t\"flow\" jsonb NOT NULL,\n\t\"created_at\" timestamp (3) with time zone NOT NULL,\n\tCONSTRAINT \"flow_versions_flow_id_version_id_pk\" PRIMARY KEY(\"flow_id\",\"version_id\")\n);\n",
    "\nCREATE INDEX \"flow_chats_due_idx\" ON \"agent_chat\".\"flow_chats\" USING btree (\"due_at\");",
    "\nCREATE INDEX \"flow_chats_flow_state_idx\" ON \"agent_chat\".\"flow_chats\" USING btree (\"flow_id\",\"version_id\",\"state_id\");",
    "\nCREATE INDEX \"flow_chats_owner_idx\" ON \"agent_chat\".\"flow_chats\" USING btree (\"owner_id\");",
  ] },
  // 0001_days_pause_side_tasks
  { folderMillis: 1791943331182, hash: "8628ea693da96cd20165117d97fba10432407edbbdf619a15ccd07c7eaa0771f", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"flow_people\" (\n\t\"owner_id\" text PRIMARY KEY NOT NULL,\n\t\"time_zone\" text NOT NULL,\n\t\"updated_at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"flow_side_tasks\" (\n\t\"owner_id\" text NOT NULL,\n\t\"task_id\" text NOT NULL,\n\t\"chat_id\" text DEFAULT '' NOT NULL,\n\t\"asks\" integer DEFAULT 0 NOT NULL,\n\t\"done_at\" timestamp (3) with time zone,\n\tCONSTRAINT \"flow_side_tasks_owner_id_task_id_chat_id_pk\" PRIMARY KEY(\"owner_id\",\"task_id\",\"chat_id\")\n);\n",
    "\nALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"ended_at\" timestamp (3) with time zone;",
    "\nALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"end_reason\" text;",
    "\nALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"paused_until\" timestamp (3) with time zone;",
    "\nALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"window_closed\" boolean DEFAULT false NOT NULL;",
    "\nALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"day_closed_on\" text;",
    "\nALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"delivery\" jsonb;",
  ] },
  // 0002_chat_placement
  { folderMillis: 1791945774083, hash: "dce2b53e28ddbb914def78a55ce5a49726548f08869580f5c86a9eff22785ef1", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"placement\" jsonb;",
  ] },
  // 0003_chat_reopen
  { folderMillis: 1792408865798, hash: "d5ab6a178b8dbd72ed9c7715127fc154654fa97715e4b9455ebf70b3e619db01", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"reopened_at\" timestamp (3) with time zone;",
  ] },
  // 0004_transition_mode
  { folderMillis: 1793174400000, hash: "0e4a200d7861804d6af6a0619a8490fd0e6cfcc476190b95c3430e4ea1bdce6c", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"flow_chats\" ADD COLUMN \"transition_mode\" text NOT NULL DEFAULT 'rails';\n",
  ] },
  // 0005_first_message_holds
  { folderMillis: 1794323056710, hash: "ad5b908098e5ee6af1aca5dbe7d54e9077d4ad6b4a2443b9bd32de6d270bd12f", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"flow_first_message_holds\" (\n\t\"owner_id\" text NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"day\" text NOT NULL,\n\t\"until\" timestamp (3) with time zone NOT NULL,\n\tCONSTRAINT \"flow_first_message_holds_owner_id_chat_id_pk\" PRIMARY KEY(\"owner_id\",\"chat_id\")\n);\n",
  ] },
];
