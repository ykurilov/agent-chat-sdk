// Создано scripts/embed-migrations.mjs из packages/background/drizzle/postgres; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1791177856034, hash: "b3729f1ed99b86680476f3b97abf5ba775a380a1e70a8e12afac724a145024b3", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"background_tasks\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"message_id\" text NOT NULL,\n\t\"tool_call_id\" text NOT NULL,\n\t\"channel\" text NOT NULL,\n\t\"kind\" text NOT NULL,\n\t\"name\" text NOT NULL,\n\t\"input\" jsonb,\n\t\"title\" text NOT NULL,\n\t\"status\" text NOT NULL,\n\t\"helper_messages\" jsonb,\n\t\"progress\" jsonb,\n\t\"result\" jsonb,\n\t\"error\" text,\n\t\"lease_owner\" text,\n\t\"lease_until\" timestamp (3) with time zone,\n\t\"attempt\" integer DEFAULT 0 NOT NULL,\n\t\"created_at\" timestamp (3) with time zone NOT NULL,\n\t\"started_at\" timestamp (3) with time zone,\n\t\"finished_at\" timestamp (3) with time zone,\n\t\"delivered_at\" timestamp (3) with time zone\n);\n",
    "\nCREATE INDEX \"background_tasks_status_lease_idx\" ON \"agent_chat\".\"background_tasks\" USING btree (\"status\",\"lease_until\");",
    "\nCREATE INDEX \"background_tasks_owner_status_idx\" ON \"agent_chat\".\"background_tasks\" USING btree (\"owner_id\",\"status\");",
    "\nCREATE INDEX \"background_tasks_chat_delivered_idx\" ON \"agent_chat\".\"background_tasks\" USING btree (\"chat_id\",\"delivered_at\");",
  ] },
  // 0001_delivery_key
  { folderMillis: 1791184440303, hash: "3e0dc6b654a3f32e1f971e0237b9275c9172f39ddde7c8ab75bb11b4d187e1a7", bps: true, sql: [
    "ALTER TABLE \"agent_chat\".\"background_tasks\" ADD COLUMN \"delivery_key\" text;",
  ] },
];
