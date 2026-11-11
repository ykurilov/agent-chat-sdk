// Создано scripts/embed-migrations.mjs из packages/images/drizzle/sqlite; не править руками: `pnpm db:generate` пакета пересоздаёт файл.
import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";

export const migrations: readonly EmbeddedMigration[] = [
  // 0000_init
  { folderMillis: 1791197015748, hash: "ef5556205385efd1f0b645cb551874518d24a4a0aef660985c1bb1e96d407643", bps: true, sql: [
    "CREATE TABLE `image_jobs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`key` text NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`chat_id` text NOT NULL,\n\t`group_name` text,\n\t`status` text NOT NULL,\n\t`active` integer NOT NULL,\n\t`open` integer NOT NULL,\n\t`lease_owner` text,\n\t`lease_until` integer,\n\t`version` integer NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`finished_at` integer,\n\t`body` text NOT NULL\n);\n",
    "\nCREATE INDEX `image_jobs_owner_key_idx` ON `image_jobs` (`owner_id`,`key`);",
    "\nCREATE UNIQUE INDEX `image_jobs_open_key_idx` ON `image_jobs` (`owner_id`,`key`) WHERE open = 1;",
    "\nCREATE INDEX `image_jobs_group_idx` ON `image_jobs` (`group_name`);",
    "\nCREATE INDEX `image_jobs_active_lease_idx` ON `image_jobs` (`active`,`lease_until`);",
  ] },
];
