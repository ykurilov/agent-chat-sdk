import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createDrizzleChatStorage, storageSchema } from "../../src/drizzle-chat-storage";
import { emptyDatabaseSnapshot } from "./pglite-snapshot";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface PgliteChatStorage extends ChatStorage {
  close(): Promise<void>;
}

/**
 * Хранилище на встроенном PostgreSQL (pglite) внутри процесса: те же запросы и те же миграции, что в проде,
 * без сети и без установленной базы. Каждый вызов — новая пустая база. `onQuery` видит каждый запрос с параметрами.
 */
export async function createPgliteChatStorage(options: { onQuery?: (query: string, params: unknown[]) => void } = {}): Promise<PgliteChatStorage> {
  const database = await PGlite.create({ loadDataDir: await emptyDatabaseSnapshot() });
  const { onQuery } = options;
  const db = drizzle(database, { schema: storageSchema, ...(onQuery && { logger: { logQuery: onQuery } }) });
  await migrate(db, { migrationsFolder, migrationsSchema: "agent_chat" });
  return { ...createDrizzleChatStorage(db), close: () => database.close() };
}
