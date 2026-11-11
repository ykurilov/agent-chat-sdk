// Создано scripts/embed-migrations.mjs из packages/skills/drizzle/sqlite; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1792011806048, hash: "6be69736d102594ecd9a8d504841c332243f98e517eb88371016c96f47d99c70", bps: true, sql: [
    "CREATE TABLE `skill_loads` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`name` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`turn_id` text NOT NULL,\n\t`loaded_at` integer NOT NULL\n);\n",
    "\nCREATE INDEX `skill_loads_name_loaded_idx` ON `skill_loads` (`name`,`loaded_at`);",
    "\nCREATE TABLE `skill_versions` (\n\t`name` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`when_to_use` text NOT NULL,\n\t`body` text NOT NULL,\n\t`author` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\tPRIMARY KEY(`name`, `version`)\n);\n",
    "\nCREATE TABLE `skills` (\n\t`name` text PRIMARY KEY NOT NULL,\n\t`when_to_use` text NOT NULL,\n\t`body` text NOT NULL,\n\t`status` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`created_by` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_by` text NOT NULL,\n\t`updated_at` integer NOT NULL\n);\n",
  ] },
];
