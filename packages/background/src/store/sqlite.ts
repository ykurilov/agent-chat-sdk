import Database from "better-sqlite3";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { TaskCondition, TaskPatch, TaskRecord, TaskStore } from "../types";
import { BACKGROUND_MIGRATIONS_TABLE } from "./migration-settings";
import { backgroundTasks } from "./sqlite-schema";
import { meetsCondition, NOTICE_STATUSES, patchEntries, RUNNING_STATUSES, withoutEmptyFields } from "./task-store";

type Row = typeof backgroundTasks.$inferSelect;

const TIME_FIELDS = ["leaseUntil", "createdAt", "startedAt", "finishedAt", "deliveredAt"] as const;
const toMs = (iso: string | undefined | null) => (iso === undefined || iso === null ? null : Date.parse(iso));
const toIso = (ms: number | null) => (ms === null ? undefined : new Date(ms).toISOString());

function toRecord(row: Row): TaskRecord {
  return withoutEmptyFields({
    ...row,
    leaseUntil: toIso(row.leaseUntil),
    createdAt: toIso(row.createdAt)!,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    deliveredAt: toIso(row.deliveredAt),
  } as TaskRecord);
}

/** Запись или правка как колонки таблицы: времена — миллисекунды. */
function toColumns(patch: TaskPatch | TaskRecord): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [key, value] of patchEntries(patch)) {
    columns[key] = (TIME_FIELDS as readonly string[]).includes(key) ? toMs(value as string | null) : value;
  }
  return columns;
}

/**
 * Хранилище задач в файле SQLite. Схема приводится к последней миграции при открытии; файл может быть общим
 * с хранилищем чатов. Две копии сервера на одном файле делят задачи через аренду.
 */
export function createSqliteTaskStore(filePath: string, migrationsFolder: string): TaskStore {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder, migrationsTable: BACKGROUND_MIGRATIONS_TABLE });
  const owned = (ownerId: string, taskId: string) => and(eq(backgroundTasks.id, taskId), eq(backgroundTasks.ownerId, ownerId));
  const isRunning = inArray(backgroundTasks.status, [...RUNNING_STATUSES]);
  /** Условие записи — в том же `update … where`: проверка и запись одним действием базы. */
  const condition = (when: TaskCondition | undefined) =>
    and(
      when?.leaseOwner !== undefined ? eq(backgroundTasks.leaseOwner, when.leaseOwner) : undefined,
      when?.statuses !== undefined ? inArray(backgroundTasks.status, [...when.statuses]) : undefined,
      when?.pendingApprovalId !== undefined ? sql`json_extract(${backgroundTasks.progress}, '$.pendingApproval.approvalId') = ${when.pendingApprovalId}` : undefined,
    );

  function countActive(executor: Pick<typeof db, "select">, ownerId: string): number {
    const row = executor
      .select({ count: sql<number>`count(*)` })
      .from(backgroundTasks)
      .where(and(eq(backgroundTasks.ownerId, ownerId), isRunning))
      .get();
    return Number(row?.count ?? 0);
  }

  async function get(ownerId: string, taskId: string): Promise<TaskRecord | null> {
    const row = db.select().from(backgroundTasks).where(owned(ownerId, taskId)).get();
    return row ? toRecord(row) : null;
  }

  return {
    async create(task) {
      db.insert(backgroundTasks).values(toColumns(task) as Row).run();
    },
    get,
    async update(ownerId, taskId, patch, when) {
      const columns = toColumns(patch);
      if (Object.keys(columns).length === 0) {
        const task = await get(ownerId, taskId);
        return task && meetsCondition(task, when) ? task : null;
      }
      const row = db.update(backgroundTasks).set(columns).where(and(owned(ownerId, taskId), condition(when))).returning().get();
      return row ? toRecord(row) : null;
    },
    async listForChat(ownerId, chatId) {
      const rows = db
        .select()
        .from(backgroundTasks)
        .where(and(eq(backgroundTasks.ownerId, ownerId), eq(backgroundTasks.chatId, chatId)))
        .orderBy(asc(backgroundTasks.createdAt), asc(backgroundTasks.id))
        .all();
      return rows.map(toRecord);
    },
    async countActive(ownerId) {
      return countActive(db, ownerId);
    },
    async admitWithinLimit(admission, maxActive) {
      // Транзакция на запись с самого начала (`immediate`): вторая копия на том же файле ждёт её конца и считает заново.
      return db.transaction(
        (tx) => {
          if ("create" in admission) {
            if (countActive(tx, admission.create.ownerId) >= maxActive) return "no_slot";
            tx.insert(backgroundTasks).values(toColumns(admission.create) as Row).run();
            return admission.create;
          }
          const { ownerId, taskId, patch, when } = admission.resume;
          if (countActive(tx, ownerId) >= maxActive) return "no_slot";
          const row = tx.update(backgroundTasks).set(toColumns(patch)).where(and(owned(ownerId, taskId), condition(when))).returning().get();
          return row ? toRecord(row) : null;
        },
        { behavior: "immediate" },
      );
    },
    async claim(taskId, leaseOwner, leaseUntil, now) {
      const nowMs = toMs(now)!;
      // Одно условное обновление: из двух копий, пришедших одновременно, условие выполнится только у первой.
      const row = db
        .update(backgroundTasks)
        .set({
          leaseOwner,
          leaseUntil: toMs(leaseUntil),
          status: sql`case when ${isRunning} then 'running' else ${backgroundTasks.status} end`,
          attempt: sql`case when ${isRunning} then ${backgroundTasks.attempt} + 1 else ${backgroundTasks.attempt} end`,
          startedAt: sql`case when ${isRunning} then coalesce(${backgroundTasks.startedAt}, ${nowMs}) else ${backgroundTasks.startedAt} end`,
        })
        .where(
          and(
            eq(backgroundTasks.id, taskId),
            isNull(backgroundTasks.deliveredAt),
            or(eq(backgroundTasks.leaseOwner, leaseOwner), isNull(backgroundTasks.leaseUntil), lt(backgroundTasks.leaseUntil, nowMs)),
          ),
        )
        .returning()
        .get();
      return row ? toRecord(row) : null;
    },
    async renewLease(taskId, leaseOwner, leaseUntil) {
      const renewed = db
        .update(backgroundTasks)
        .set({ leaseUntil: toMs(leaseUntil) })
        .where(and(eq(backgroundTasks.id, taskId), eq(backgroundTasks.leaseOwner, leaseOwner), isNull(backgroundTasks.deliveredAt)))
        .run();
      return renewed.changes > 0;
    },
    async listExpired(now) {
      const rows = db
        .select()
        .from(backgroundTasks)
        .where(and(isNull(backgroundTasks.deliveredAt), or(isNull(backgroundTasks.leaseUntil), lt(backgroundTasks.leaseUntil, toMs(now)!))))
        .orderBy(asc(backgroundTasks.createdAt))
        .all();
      return rows.map(toRecord);
    },
    async listUndelivered(ownerId, chatId) {
      const rows = db
        .select()
        .from(backgroundTasks)
        .where(
          and(
            eq(backgroundTasks.ownerId, ownerId),
            eq(backgroundTasks.chatId, chatId),
            isNull(backgroundTasks.deliveredAt),
            inArray(backgroundTasks.status, [...NOTICE_STATUSES]),
          ),
        )
        .orderBy(asc(backgroundTasks.createdAt), asc(backgroundTasks.id))
        .all();
      return rows.map(toRecord);
    },
    async markDelivered(taskIds, deliveryKey, at) {
      if (taskIds.length === 0) return;
      db.update(backgroundTasks)
        .set({ deliveredAt: toMs(at), leaseOwner: null, leaseUntil: null })
        .where(
          and(
            inArray(backgroundTasks.id, [...taskIds]),
            eq(backgroundTasks.deliveryKey, deliveryKey),
            inArray(backgroundTasks.status, [...NOTICE_STATUSES]),
          ),
        )
        .run();
    },
    async deleteForChat(ownerId, chatId) {
      db.delete(backgroundTasks)
        .where(and(eq(backgroundTasks.ownerId, ownerId), eq(backgroundTasks.chatId, chatId)))
        .run();
    },
    async close() {
      sqlite.close();
    },
  };
}
