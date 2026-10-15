import Database from "better-sqlite3";
import { desc, eq, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { McpStore, StoredMcpServer } from "../types";
import { MCP_MIGRATIONS_TABLE } from "./migration-settings";
import { callRecord, parsedServerColumns, serverTextColumns } from "./rows";
import { mcpCalls, mcpRevision, mcpServers } from "./sqlite-schema";

type ServerRow = typeof mcpServers.$inferSelect;

const toMs = (iso: string) => Date.parse(iso);
const toIso = (ms: number) => new Date(ms).toISOString();

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
    toolsUpdatedAt: row.toolsUpdatedAt === null ? null : toIso(row.toolsUpdatedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toRow(server: StoredMcpServer): ServerRow {
  return {
    ...server,
    ...serverTextColumns(server),
    toolsUpdatedAt: server.toolsUpdatedAt === null ? null : toMs(server.toolsUpdatedAt),
    createdAt: toMs(server.createdAt),
    updatedAt: toMs(server.updatedAt),
  };
}

/** Хранилище в файле SQLite (может быть общим с хранилищем чатов). Таблицы приводятся к последней миграции при открытии. */
export function createSqliteStore(filePath: string, migrationsFolder: string): McpStore & { close(): void } {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder, migrationsTable: MCP_MIGRATIONS_TABLE });

  /** Новая отметка версии — в той же записи, что и правка сервера. */
  const bumpRevision = (tx: Pick<typeof db, "insert">) =>
    tx
      .insert(mcpRevision)
      .values({ id: 1, revision: 1 })
      .onConflictDoUpdate({ target: mcpRevision.id, set: { revision: sql`${mcpRevision.revision} + 1` } })
      .run();

  return {
    async listServers() {
      return db.select().from(mcpServers).orderBy(mcpServers.createdAt, mcpServers.id).all().map(toServer);
    },
    async getServer(id) {
      const row = db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
      return row ? toServer(row) : null;
    },
    async saveServer(server) {
      const row = toRow(server);
      db.transaction((tx) => {
        tx.insert(mcpServers).values(row).onConflictDoUpdate({ target: mcpServers.id, set: row }).run();
        bumpRevision(tx);
      });
    },
    async deleteServer(id) {
      db.transaction((tx) => {
        tx.delete(mcpCalls).where(eq(mcpCalls.serverId, id)).run();
        tx.delete(mcpServers).where(eq(mcpServers.id, id)).run();
        bumpRevision(tx);
      });
    },
    async revision() {
      return db.select().from(mcpRevision).where(eq(mcpRevision.id, 1)).get()?.revision ?? 0;
    },
    async recordCall(call) {
      db.insert(mcpCalls).values({ ...call, error: call.error ?? null, startedAt: toMs(call.startedAt) }).run();
    },
    async listCalls({ serverId, limit }) {
      return db
        .select()
        .from(mcpCalls)
        .where(serverId === undefined ? undefined : eq(mcpCalls.serverId, serverId))
        .orderBy(desc(mcpCalls.startedAt), desc(mcpCalls.id))
        .limit(limit)
        .all()
        .map((row) => callRecord({ ...row, startedAt: toIso(row.startedAt) }));
    },
    async deleteCallsBefore(before) {
      return db.delete(mcpCalls).where(lt(mcpCalls.startedAt, toMs(before))).run().changes;
    },
    close() {
      sqlite.close();
    },
  };
}
