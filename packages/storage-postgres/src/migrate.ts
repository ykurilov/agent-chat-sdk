import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Постоянное число для блокировки базы: одинаково у всех серверов и всех версий SDK. */
const MIGRATION_LOCK_KEY = 7_311_900_442;

/**
 * Приводит схему `agent_chat` к последней миграции. Идёт на одном соединении под блокировкой базы:
 * если несколько серверов стартуют сразу, второй ждёт первого и видит применённые миграции.
 */
export async function migrateToLatest(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat" });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
