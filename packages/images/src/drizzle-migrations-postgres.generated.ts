// Создано scripts/embed-migrations.mjs из packages/images/drizzle/postgres; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1791197016219, hash: "4d57a036d6d4ab5cf324947c925c608ce61c18f25f17e281e5132a97a3d0ace2", bps: true, sql: [
    "CREATE SCHEMA IF NOT EXISTS \"agent_chat\";\n",
    "\nCREATE TABLE \"agent_chat\".\"image_jobs\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"key\" text NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"group_name\" text,\n\t\"status\" text NOT NULL,\n\t\"active\" boolean NOT NULL,\n\t\"open\" boolean NOT NULL,\n\t\"lease_owner\" text,\n\t\"lease_until\" timestamp (3) with time zone,\n\t\"version\" integer NOT NULL,\n\t\"created_at\" timestamp (3) with time zone NOT NULL,\n\t\"updated_at\" timestamp (3) with time zone NOT NULL,\n\t\"finished_at\" timestamp (3) with time zone,\n\t\"body\" jsonb NOT NULL\n);\n",
    "\nCREATE INDEX \"image_jobs_owner_key_idx\" ON \"agent_chat\".\"image_jobs\" USING btree (\"owner_id\",\"key\");",
    "\nCREATE UNIQUE INDEX \"image_jobs_open_key_idx\" ON \"agent_chat\".\"image_jobs\" USING btree (\"owner_id\",\"key\") WHERE open;",
    "\nCREATE INDEX \"image_jobs_group_idx\" ON \"agent_chat\".\"image_jobs\" USING btree (\"group_name\");",
    "\nCREATE INDEX \"image_jobs_active_lease_idx\" ON \"agent_chat\".\"image_jobs\" USING btree (\"active\",\"lease_until\");",
  ] },
];
