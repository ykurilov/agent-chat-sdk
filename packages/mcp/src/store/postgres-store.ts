import { desc, eq, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migratePostgresSchema } from "@ykurilov/agent-chat-core";
import type { Pool } from "pg";
import type { McpStore, StoredMcpServer } from "../types";
import { MCP_MIGRATION_LOCK_KEY, MCP_MIGRATIONS_TABLE } from "./migration-settings";
import { mcpCalls, mcpRevision, mcpServers } from "./postgres-schema";
import { callRecord, parsedServerColumns, serverTextColumns } from "./rows";

type ServerRow = typeof mcpServers.$inferSelect;

/** PostgreSQL не хранит символ NUL в тексте: в записи его не бывает, но чужой сервер мог прислать. */
const withoutNul = (text: string) => text.replaceAll("\u0000", "");

function toServer(row: ServerRow): StoredMcpServer {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    status: row.status as StoredMcpServer["status"],
    transport: row.transport as StoredMcpServer["transport"],
    viaProxy: row.viaProxy,
    timeoutMs: row.timeoutMs,
    secretUrl: row.secretUrl,
    displayUrl: row.displayUrl,
    urlHasHiddenParts: row.urlHasHiddenParts,
    secretHeaders: row.secretHeaders,
    ...parsedServerColumns(row),
    toolsUpdatedAt: row.toolsUpdatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRow(server: StoredMcpServer): ServerRow {
  const text = serverTextColumns(server);
  return {
    ...server,
    name: withoutNul(server.name),
    headerNames: text.headerNames,
    // В JSON-тексте NUL записан как \u0000 — шесть обычных знаков, базе он не мешает.
    tools: text.tools,
    toolSettings: text.toolSettings,
    lastCheck: text.lastCheck,
    toolsUpdatedAt: server.toolsUpdatedAt === null ? null : new Date(server.toolsUpdatedAt),
    createdAt: new Date(server.createdAt),
    updatedAt: new Date(server.updatedAt),
  };
}

/**
 * Приводит таблицы к последней миграции. Схема `agent_chat` создаётся под общей блокировкой всех пакетов, миграции — под своей:
 * копии пакета ждут друг друга, а разные пакеты стартуют разом на пустой базе без гонки за схему.
 */
async function migrateToLatest(pool: Pool, migrationsFolder: string): Promise<void> {
  await migratePostgresSchema({
    connect: () => pool.connect(),
    lockKey: MCP_MIGRATION_LOCK_KEY,
    migrate: (client) => migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat", migrationsTable: MCP_MIGRATIONS_TABLE }),
  });
}

/** Хранилище в PostgreSQL (схема `agent_chat`) на пуле приложения. Миграция — при первом обращении; пул закрывает приложение. */
export function createPostgresStore(pool: Pool, migrationsFolder: string): McpStore {
  const db = drizzle(pool);
  const ready = migrateToLatest(pool, migrationsFolder);
  // Ошибку миграции увидит первое обращение; здесь — чтобы не было «необработанного отказа».
  ready.catch(() => {});

  /** Новая отметка версии — в той же транзакции, что и правка сервера. */
  const bumpRevision = (tx: Pick<typeof db, "insert">) =>
    tx
      .insert(mcpRevision)
      .values({ id: 1, revision: 1 })
      .onConflictDoUpdate({ target: mcpRevision.id, set: { revision: sql`${mcpRevision.revision} + 1` } });

  return {
    async listServers() {
      await ready;
      return (await db.select().from(mcpServers).orderBy(mcpServers.createdAt, mcpServers.id)).map(toServer);
    },
    async getServer(id) {
      await ready;
      const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
      return row ? toServer(row) : null;
    },
    async saveServer(server) {
      await ready;
      const row = toRow(server);
      await db.transaction(async (tx) => {
        await tx.insert(mcpServers).values(row).onConflictDoUpdate({ target: mcpServers.id, set: row });
        await bumpRevision(tx);
      });
    },
    async deleteServer(id) {
      await ready;
      await db.transaction(async (tx) => {
        await tx.delete(mcpCalls).where(eq(mcpCalls.serverId, id));
        await tx.delete(mcpServers).where(eq(mcpServers.id, id));
        await bumpRevision(tx);
      });
    },
    async revision() {
      await ready;
      const [row] = await db.select().from(mcpRevision).where(eq(mcpRevision.id, 1));
      return row?.revision ?? 0;
    },
    async recordCall(call) {
      await ready;
      await db.insert(mcpCalls).values({ ...call, error: call.error === undefined ? null : withoutNul(call.error), startedAt: new Date(call.startedAt) });
    },
    async listCalls({ serverId, limit }) {
      await ready;
      const rows = await db
        .select()
        .from(mcpCalls)
        .where(serverId === undefined ? undefined : eq(mcpCalls.serverId, serverId))
        .orderBy(desc(mcpCalls.startedAt), desc(mcpCalls.id))
        .limit(limit);
      return rows.map((row) => callRecord({ ...row, startedAt: row.startedAt.toISOString() }));
    },
    async deleteCallsBefore(before) {
      await ready;
      const removed = await db.delete(mcpCalls).where(lt(mcpCalls.startedAt, new Date(before))).returning({ id: mcpCalls.id });
      return removed.length;
    },
  };
}
