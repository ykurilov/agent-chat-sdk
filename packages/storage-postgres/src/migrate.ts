import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migratePostgresSchema } from "@ykurilov/agent-chat-core";
import type { Pool } from "pg";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Постоянное число для блокировки базы: одинаково у всех серверов и всех версий SDK. */
const MIGRATION_LOCK_KEY = 7_311_900_442;

/**
 * Приводит схему `agent_chat` к последней миграции. Схема `agent_chat` создаётся под общей блокировкой всех пакетов, миграции — под своей:
 * копии пакета ждут друг друга, а разные пакеты стартуют разом на пустой базе без гонки за схему.
 */
export async function migrateToLatest(pool: Pool): Promise<void> {
  await migratePostgresSchema({
    connect: () => pool.connect(),
    lockKey: MIGRATION_LOCK_KEY,
    migrate: (client) => migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat" }),
  });
}
