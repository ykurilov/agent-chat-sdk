// Создано scripts/embed-migrations.mjs из packages/skills/drizzle/postgres; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1792011806586, hash: "843717f97687d8ccf0b3ecd676be0be1bd57e037b0e1119b97167c63c4a728ef", bps: true, sql: [
    "CREATE TABLE \"agent_chat\".\"skill_loads\" (\n\t\"id\" bigserial PRIMARY KEY NOT NULL,\n\t\"name\" text NOT NULL,\n\t\"version\" integer NOT NULL,\n\t\"chat_id\" text NOT NULL,\n\t\"owner_id\" text NOT NULL,\n\t\"turn_id\" text NOT NULL,\n\t\"loaded_at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"skill_versions\" (\n\t\"name\" text NOT NULL,\n\t\"version\" integer NOT NULL,\n\t\"when_to_use\" text NOT NULL,\n\t\"body\" text NOT NULL,\n\t\"author\" text NOT NULL,\n\t\"created_at\" timestamp (3) with time zone NOT NULL,\n\tCONSTRAINT \"skill_versions_name_version_pk\" PRIMARY KEY(\"name\",\"version\")\n);\n",
    "\nCREATE TABLE \"agent_chat\".\"skills\" (\n\t\"name\" text PRIMARY KEY NOT NULL,\n\t\"when_to_use\" text NOT NULL,\n\t\"body\" text NOT NULL,\n\t\"status\" text NOT NULL,\n\t\"version\" integer NOT NULL,\n\t\"created_by\" text NOT NULL,\n\t\"created_at\" timestamp (3) with time zone NOT NULL,\n\t\"updated_by\" text NOT NULL,\n\t\"updated_at\" timestamp (3) with time zone NOT NULL\n);\n",
    "\nCREATE INDEX \"skill_loads_name_loaded_idx\" ON \"agent_chat\".\"skill_loads\" USING btree (\"name\",\"loaded_at\");",
  ] },
];
