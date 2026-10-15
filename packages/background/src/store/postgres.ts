import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migratePostgresSchema } from "@ykurilov/agent-chat-core";
import type { Pool } from "pg";
import type { TaskCondition, TaskPatch, TaskRecord, TaskStore } from "../types";
import { BACKGROUND_MIGRATION_LOCK_KEY, BACKGROUND_MIGRATIONS_TABLE } from "./migration-settings";
import { backgroundTasks } from "./postgres-schema";
import { meetsCondition, NOTICE_STATUSES, patchEntries, RUNNING_STATUSES, withoutEmptyFields, withoutNul } from "./task-store";

type Row = typeof backgroundTasks.$inferSelect;

const TIME_FIELDS = ["leaseUntil", "createdAt", "startedAt", "finishedAt", "deliveredAt"] as const;
const toDate = (iso: string | null) => (iso === null ? null : new Date(iso));
const toIso = (date: Date | null) => (date === null ? undefined : date.toISOString());

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

/** Запись или правка как колонки таблицы: времена — `Date`, без символа NUL. */
function toColumns(patch: TaskPatch | TaskRecord): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [key, value] of patchEntries(patch)) {
    columns[key] = (TIME_FIELDS as readonly string[]).includes(key) ? toDate(value as string | null) : withoutNul(value);
  }
  return columns;
}

/**
 * Приводит таблицу задач к последней миграции. Схема `agent_chat` создаётся под общей блокировкой всех пакетов, миграции — под своей:
 * копии пакета ждут друг друга, а разные пакеты стартуют разом на пустой базе без гонки за схему.
 */
export async function migrateBackgroundTasksToLatest(pool: Pool, migrationsFolder: string): Promise<void> {
  await migratePostgresSchema({
    connect: () => pool.connect(),
    lockKey: BACKGROUND_MIGRATION_LOCK_KEY,
    migrate: (client) => migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat", migrationsTable: BACKGROUND_MIGRATIONS_TABLE }),
  });
}

/**
 * Хранилище задач в PostgreSQL (схема `agent_chat`) на пуле приложения. Миграция идёт при первом обращении,
 * каждая операция её дожидается. Закрытие пул не закрывает: он принадлежит приложению.
 */
export function createPostgresTaskStore(pool: Pool, migrationsFolder: string): TaskStore {
  const db = drizzle(pool);
  const ready = migrateBackgroundTasksToLatest(pool, migrationsFolder);
  // Ошибка миграции придёт в каждую операцию; без этого она всплыла бы ещё и как необработанная.
  ready.catch(() => {});
  const owned = (ownerId: string, taskId: string) => and(eq(backgroundTasks.id, taskId), eq(backgroundTasks.ownerId, ownerId));
  const isRunning = inArray(backgroundTasks.status, [...RUNNING_STATUSES]);
  /** Условие записи — в том же `update … where`: проверка и запись одним действием базы. */
  const condition = (when: TaskCondition | undefined) =>
    and(
      when?.leaseOwner !== undefined ? eq(backgroundTasks.leaseOwner, when.leaseOwner) : undefined,
      when?.statuses !== undefined ? inArray(backgroundTasks.status, [...when.statuses]) : undefined,
      when?.pendingApprovalId !== undefined ? sql`${backgroundTasks.progress}->'pendingApproval'->>'approvalId' = ${when.pendingApprovalId}` : undefined,
    );

  async function get(ownerId: string, taskId: string): Promise<TaskRecord | null> {
    await ready;
    const [row] = await db.select().from(backgroundTasks).where(owned(ownerId, taskId));
    return row ? toRecord(row) : null;
  }

  return {
    async create(task) {
      await ready;
      await db.insert(backgroundTasks).values(toColumns(task) as Row);
    },
    get,
    async update(ownerId, taskId, patch, when) {
      const columns = toColumns(patch);
      if (Object.keys(columns).length === 0) {
        const task = await get(ownerId, taskId);
        return task && meetsCondition(task, when) ? task : null;
      }
      await ready;
      const [row] = await db.update(backgroundTasks).set(columns).where(and(owned(ownerId, taskId), condition(when))).returning();
      return row ? toRecord(row) : null;
    },
    async listForChat(ownerId, chatId) {
      await ready;
      const rows = await db
        .select()
        .from(backgroundTasks)
        .where(and(eq(backgroundTasks.ownerId, ownerId), eq(backgroundTasks.chatId, chatId)))
        .orderBy(asc(backgroundTasks.createdAt), asc(backgroundTasks.id));
      return rows.map(toRecord);
    },
    async countActive(ownerId) {
      await ready;
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(backgroundTasks)
        .where(and(eq(backgroundTasks.ownerId, ownerId), isRunning));
      return Number(row?.count ?? 0);
    },
    async claim(taskId, leaseOwner, leaseUntil, now) {
      await ready;
      const nowDate = new Date(now);
      // Одно условное обновление: вторая копия ждёт строку, перепроверяет условие на новой версии и ничего не берёт.
      const [row] = await db
        .update(backgroundTasks)
        .set({
          leaseOwner,
          leaseUntil: new Date(leaseUntil),
          status: sql`case when ${isRunning} then 'running' else ${backgroundTasks.status} end`,
          attempt: sql`case when ${isRunning} then ${backgroundTasks.attempt} + 1 else ${backgroundTasks.attempt} end`,
          startedAt: sql`case when ${isRunning} then coalesce(${backgroundTasks.startedAt}, ${nowDate}) else ${backgroundTasks.startedAt} end`,
        })
        .where(
          and(
            eq(backgroundTasks.id, taskId),
            isNull(backgroundTasks.deliveredAt),
            or(eq(backgroundTasks.leaseOwner, leaseOwner), isNull(backgroundTasks.leaseUntil), lt(backgroundTasks.leaseUntil, nowDate)),
          ),
        )
        .returning();
      return row ? toRecord(row) : null;
    },
    async renewLease(taskId, leaseOwner, leaseUntil) {
      await ready;
      const renewed = await db
        .update(backgroundTasks)
        .set({ leaseUntil: new Date(leaseUntil) })
        .where(and(eq(backgroundTasks.id, taskId), eq(backgroundTasks.leaseOwner, leaseOwner), isNull(backgroundTasks.deliveredAt)))
        .returning({ id: backgroundTasks.id });
      return renewed.length > 0;
    },
    async listExpired(now) {
      await ready;
      const rows = await db
        .select()
        .from(backgroundTasks)
        .where(and(isNull(backgroundTasks.deliveredAt), or(isNull(backgroundTasks.leaseUntil), lt(backgroundTasks.leaseUntil, new Date(now)))))
        .orderBy(asc(backgroundTasks.createdAt));
      return rows.map(toRecord);
    },
    async listUndelivered(ownerId, chatId) {
      await ready;
      const rows = await db
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
        .orderBy(asc(backgroundTasks.createdAt), asc(backgroundTasks.id));
      return rows.map(toRecord);
    },
    async markDelivered(taskIds, deliveryKey, at) {
      if (taskIds.length === 0) return;
      await ready;
      await db
        .update(backgroundTasks)
        .set({ deliveredAt: new Date(at), leaseOwner: null, leaseUntil: null })
        .where(
          and(
            inArray(backgroundTasks.id, [...taskIds]),
            eq(backgroundTasks.deliveryKey, deliveryKey),
            inArray(backgroundTasks.status, [...NOTICE_STATUSES]),
          ),
        );
    },
    async deleteForChat(ownerId, chatId) {
      await ready;
      await db.delete(backgroundTasks).where(and(eq(backgroundTasks.ownerId, ownerId), eq(backgroundTasks.chatId, chatId)));
    },
    async close() {
      // Дожидаемся миграции: пул приложения можно закрывать сразу после.
      await ready.catch(() => {});
    },
  };
}
