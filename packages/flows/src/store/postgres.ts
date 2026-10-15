import { and, eq, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migratePostgresSchema } from "@ykurilov/agent-chat-core";
import type { Pool } from "pg";
import type { StateMap } from "../engine/migrate-run";
import type { FlowChatRecord, FlowStore, PendingFlowChange, SideTaskRecord } from "./flow-store";
import { byVersionAndState, compareText, migratePending, withoutNul } from "./flow-store-shared";
import { FLOWS_MIGRATION_LOCK_KEY, FLOWS_MIGRATIONS_TABLE } from "./migration-settings";
import { flowChats, flowClientCards, flowFirstMessages, flowPeople, flowSideTasks, flowVersions } from "./postgres-schema";

/** Хранилище, у которого можно дождаться миграции перед закрытием пула приложения. */
export type PostgresFlowStore = FlowStore & Required<Pick<FlowStore, "close">>;

type ChatRow = typeof flowChats.$inferSelect;

const toIso = (date: Date) => date.toISOString();

function toRecord(row: ChatRow): FlowChatRecord {
  return {
    chatId: row.chatId,
    ownerId: row.ownerId,
    flowId: row.flowId,
    versionId: row.versionId,
    stateId: row.stateId,
    pending: row.pending,
    dueAt: row.dueAt === null ? null : toIso(row.dueAt),
    dueExitId: row.dueExitId,
    dueBranchHead: row.dueBranchHead,
    timeZone: row.timeZone,
    updatedAt: toIso(row.updatedAt),
    endedAt: row.endedAt === null ? null : toIso(row.endedAt),
    endReason: row.endReason,
    pausedUntil: row.pausedUntil === null ? null : toIso(row.pausedUntil),
    windowClosed: row.windowClosed,
    dayClosedOn: row.dayClosedOn,
    delivery: row.delivery,
    placement: row.placement,
  };
}

type SideTaskRow = typeof flowSideTasks.$inferSelect;
const toSideTask = (row: SideTaskRow): SideTaskRecord => ({
  taskId: row.taskId,
  chatId: row.chatId === "" ? null : row.chatId,
  asks: row.asks,
  doneAt: row.doneAt === null ? null : toIso(row.doneAt),
});

/** JSON параметром запроса: текст, приведённый к `jsonb` в самой базе. */
const jsonb = (value: unknown): SQL => sql`${JSON.stringify(value)}::jsonb`;

/**
 * Дописать изменение в конец `pending`, если такого ключа там ещё нет. Условие — в том же `update`: вторая копия ждёт
 * запись и перепроверяет его уже на новой версии строки.
 */
const pendingWith = (change: PendingFlowChange): SQL =>
  sql`case when ${flowChats.pending} @> ${jsonb([{ key: change.key }])} then ${keptWith(change)}
    else ${flowChats.pending} || ${jsonb([change])} end`;

/** Тот же ключ: прежнее остаётся, но `appliedAt` перехода дописывается к ожидающему без него (как `pendingAdded`). */
function keptWith(change: PendingFlowChange): SQL {
  if (change.kind !== "transition" || change.appliedAt === undefined) return sql`${flowChats.pending}`;
  return sql`(select jsonb_agg(case when item->>'key' = ${change.key} and item->'appliedAt' is null and item->>'kind' = 'transition'
      then item || jsonb_build_object('appliedAt', ${change.appliedAt}::text) else item end order by place)
    from jsonb_array_elements(${flowChats.pending}) with ordinality as list(item, place))`;
}

/** Состояние по карте перевода: удалённые — в выбранные, остальные как были. */
function mappedStateSql(map: StateMap): SQL {
  const entries = Object.entries(map);
  if (entries.length === 0) return sql`${flowChats.stateId}`;
  const cases = entries.map(([from, to]) => sql`when ${from} then ${to}`);
  return sql`case ${flowChats.stateId} ${sql.join(cases, sql` `)} else ${flowChats.stateId} end`;
}

/** Таймер наступил, никто его не держит, разговор идёт и не на паузе. Аренда до `lease_until` включительно ещё живая. */
const dueAndFree = (now: Date) =>
  and(
    lte(flowChats.dueAt, now),
    or(isNull(flowChats.leaseUntil), lt(flowChats.leaseUntil, now)),
    isNull(flowChats.endedAt),
    or(isNull(flowChats.pausedUntil), lte(flowChats.pausedUntil, now)),
  );

/** Порядок по кодам символов, как у SQLite и памяти, а не по языку базы. */
const inCodeOrder = (column: typeof flowChats.chatId) => sql`${column} collate "C"`;

/**
 * Приводит таблицы сценариев к последней миграции. Схема `agent_chat` создаётся под общей блокировкой всех пакетов, миграции — под своей:
 * копии пакета ждут друг друга, а разные пакеты стартуют разом на пустой базе без гонки за схему.
 */
export async function migrateFlowsToLatest(pool: Pool, migrationsFolder: string): Promise<void> {
  await migratePostgresSchema({
    connect: () => pool.connect(),
    lockKey: FLOWS_MIGRATION_LOCK_KEY,
    migrate: (client) => migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat", migrationsTable: FLOWS_MIGRATIONS_TABLE }),
  });
}

/**
 * Сценарии в PostgreSQL (схема `agent_chat`) на пуле приложения. Миграция идёт при первом обращении, каждая операция
 * её дожидается. Копии сервера делят таймеры и перевод чатов через `for update skip locked`: строку, которую уже
 * берёт другая копия, эта пропускает. Закрытие пул не закрывает: он принадлежит приложению.
 */
export function createPostgresFlowStore(pool: Pool, migrationsFolder: string): PostgresFlowStore {
  const db = drizzle(pool);
  const ready = migrateFlowsToLatest(pool, migrationsFolder);
  // Ошибка миграции придёт в каждую операцию; без этого она всплыла бы ещё и как необработанная.
  ready.catch(() => {});

  async function getChat(chatId: string): Promise<ChatRow | undefined> {
    await ready;
    const [row] = await db.select().from(flowChats).where(eq(flowChats.chatId, chatId));
    return row;
  }

  return {
    async pinChat(input) {
      await ready;
      const clean = withoutNul(input);
      await db
        .insert(flowChats)
        .values({
          chatId: clean.chatId,
          ownerId: clean.ownerId,
          flowId: clean.flowId,
          versionId: clean.versionId,
          stateId: clean.stateId,
          pending: [],
          timeZone: clean.timeZone,
          ...(clean.placement && { placement: clean.placement }),
          updatedAt: new Date(clean.at),
        })
        .onConflictDoNothing();
      return toRecord((await getChat(clean.chatId))!);
    },
    async getChat(chatId) {
      const row = await getChat(chatId);
      return row ? toRecord(row) : null;
    },
    async updateChat(chatId, patch, at) {
      await ready;
      const clean = withoutNul(patch);
      const [row] = await db
        .update(flowChats)
        .set({ versionId: clean.versionId, stateId: clean.stateId, timeZone: clean.timeZone, placement: clean.placement, updatedAt: new Date(at) })
        .where(eq(flowChats.chatId, chatId))
        .returning();
      return row ? toRecord(row) : null;
    },
    async deleteChat(chatId) {
      await ready;
      await db.delete(flowChats).where(eq(flowChats.chatId, chatId));
    },

    async addPending(chatId, change) {
      await ready;
      await db.update(flowChats).set({ pending: pendingWith(withoutNul(change)) }).where(eq(flowChats.chatId, chatId));
    },
    async takePending(chatId) {
      await ready;
      // Старое значение — из строки, захваченной `for update`: вторая копия ждёт её и получает уже пустой список
      // (кроме переходов, применённых в срок: они остаются).
      const result = await db.execute<{ pending: PendingFlowChange[] }>(sql`
        with taken as (select chat_id, pending from ${flowChats} where chat_id = ${chatId} for update)
        update ${flowChats} set pending = (
          select coalesce(jsonb_agg(item order by place), '[]'::jsonb)
          from jsonb_array_elements(taken.pending) with ordinality as list(item, place)
          where item->>'kind' = 'transition' and item->'appliedAt' is not null
        ) from taken
        where ${flowChats.chatId} = taken.chat_id
        returning taken.pending`);
      return result.rows[0]?.pending ?? [];
    },

    async setDue(chatId, due, options) {
      await ready;
      await db
        .update(flowChats)
        .set({
          dueAt: due ? new Date(due.at) : null,
          dueExitId: due ? withoutNul(due.exitId) : null,
          dueBranchHead: due ? withoutNul(due.branchHead) : null,
          leaseUntil: null,
          leaseOwner: null,
        })
        .where(and(eq(flowChats.chatId, chatId), options?.unlessDelivery ? isNull(flowChats.delivery) : undefined));
    },
    async leaseDue({ now, owner, leaseMs, limit }) {
      await ready;
      const nowDate = new Date(now);
      // Строки, которые сейчас берёт другая копия, пропускаются; условие повторено снаружи — его база перепроверит
      // на новой версии строки, если та успела измениться.
      // Выборка — отдельным шагом `with`: подзапрос с пределом внутри `in (…)` база может перечитать и взять больше.
      const due = db.$with("due").as(
        db
          .select({ chatId: flowChats.chatId })
          .from(flowChats)
          .where(dueAndFree(nowDate))
          .orderBy(flowChats.dueAt, inCodeOrder(flowChats.chatId))
          .limit(limit)
          .for("update", { skipLocked: true }),
      );
      const rows = await db
        .with(due)
        .update(flowChats)
        .set({ leaseOwner: withoutNul(owner), leaseUntil: new Date(nowDate.getTime() + leaseMs) })
        .where(and(inArray(flowChats.chatId, db.select({ chatId: due.chatId }).from(due)), dueAndFree(nowDate)))
        .returning();
      return rows.map(toRecord).sort((left, right) => compareText(left.dueAt!, right.dueAt!) || compareText(left.chatId, right.chatId));
    },
    async releaseLease(chatId, owner) {
      await ready;
      await db
        .update(flowChats)
        .set({ leaseOwner: null, leaseUntil: null })
        .where(and(eq(flowChats.chatId, chatId), eq(flowChats.leaseOwner, owner)));
    },
    async renewLease({ chatId, owner, now, leaseMs }) {
      await ready;
      const renewed = await db
        .update(flowChats)
        .set({ leaseUntil: new Date(new Date(now).getTime() + leaseMs) })
        .where(and(eq(flowChats.chatId, chatId), eq(flowChats.leaseOwner, withoutNul(owner))))
        .returning({ chatId: flowChats.chatId });
      return renewed.length > 0;
    },

    async saveVersion(input) {
      await ready;
      const clean = withoutNul(input);
      const inserted = await db
        .insert(flowVersions)
        .values({ flowId: clean.flowId, versionId: clean.versionId, hash: clean.hash, flow: clean.flow, createdAt: new Date(clean.at) })
        .onConflictDoNothing()
        .returning({ hash: flowVersions.hash });
      if (inserted.length > 0) return "new";
      const [saved] = await db
        .select({ hash: flowVersions.hash })
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, clean.flowId), eq(flowVersions.versionId, clean.versionId)));
      return saved?.hash === clean.hash ? "same" : "conflict";
    },
    async getVersion(flowId, versionId) {
      await ready;
      const [row] = await db
        .select()
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.versionId, versionId)));
      return row ? { ...row, createdAt: toIso(row.createdAt) } : null;
    },

    async countChatsByState({ flowId }) {
      await ready;
      const rows = await db
        .select({ versionId: flowChats.versionId, stateId: flowChats.stateId, chats: sql<number>`count(*)::int` })
        .from(flowChats)
        .where(eq(flowChats.flowId, flowId))
        .groupBy(flowChats.versionId, flowChats.stateId);
      return rows.map((row) => ({ ...row, chats: Number(row.chats) })).sort(byVersionAndState);
    },
    async listFlowChats(input) {
      await ready;
      const { flowId, exceptVersionId, chatIds } = withoutNul(input);
      if (chatIds?.length === 0) return [];
      const rows = await db
        .select({
          chatId: flowChats.chatId,
          ownerId: flowChats.ownerId,
          flowId: flowChats.flowId,
          versionId: flowChats.versionId,
          stateId: flowChats.stateId,
          endedAt: flowChats.endedAt,
          endReason: flowChats.endReason,
        })
        .from(flowChats)
        .where(
          and(
            eq(flowChats.flowId, flowId),
            exceptVersionId === undefined ? undefined : ne(flowChats.versionId, exceptVersionId),
            chatIds === undefined ? undefined : inArray(flowChats.chatId, chatIds),
          ),
        )
        .orderBy(inCodeOrder(flowChats.chatId));
      return rows.map((row) => ({ ...row, endedAt: row.endedAt === null ? null : toIso(row.endedAt) }));
    },
    async migrateBatch(input) {
      await ready;
      const clean = withoutNul(input);
      const change = migratePending(clean);
      if (clean.chatIds?.length === 0) return { moved: [] };
      const notYetMoved = and(
        eq(flowChats.flowId, clean.flowId),
        ne(flowChats.versionId, clean.toVersionId),
        clean.chatIds === undefined ? undefined : inArray(flowChats.chatId, clean.chatIds),
      );
      const batch = db
        .select({ chatId: flowChats.chatId })
        .from(flowChats)
        .where(notYetMoved)
        .orderBy(inCodeOrder(flowChats.chatId))
        .limit(clean.limit)
        .for("update", { skipLocked: true });
      const moved = await db
        .update(flowChats)
        .set({ versionId: clean.toVersionId, stateId: mappedStateSql(clean.map), pending: pendingWith(change), updatedAt: new Date(clean.at) })
        .where(and(inArray(flowChats.chatId, batch), notYetMoved))
        .returning({ chatId: flowChats.chatId });
      return { moved: moved.map((row) => row.chatId) };
    },

    async readCard(ownerId) {
      await ready;
      // Значение читаем текстом и разбираем сами: иначе строка «007» из jsonb вернулась бы числом 7.
      const rows = await db
        .select({
          fieldId: flowClientCards.fieldId,
          value: sql<string>`${flowClientCards.value}::text`,
          updatedAt: flowClientCards.updatedAt,
          chatId: flowClientCards.chatId,
          flowId: flowClientCards.flowId,
        })
        .from(flowClientCards)
        .where(eq(flowClientCards.ownerId, ownerId));
      return rows
        .map((row) => ({ ...row, value: JSON.parse(row.value) as unknown, updatedAt: toIso(row.updatedAt) }))
        .sort((left, right) => compareText(left.fieldId, right.fieldId));
    },
    async writeCardField(input) {
      await ready;
      const clean = withoutNul(input);
      const entry = { value: jsonb(clean.value), updatedAt: new Date(clean.at), chatId: clean.chatId, flowId: clean.flowId };
      await db
        .insert(flowClientCards)
        .values({ ownerId: clean.ownerId, fieldId: clean.fieldId, ...entry })
        .onConflictDoUpdate({ target: [flowClientCards.ownerId, flowClientCards.fieldId], set: entry });
    },
    async forgetCard(ownerId, fieldId) {
      await ready;
      await db
        .delete(flowClientCards)
        .where(and(eq(flowClientCards.ownerId, ownerId), fieldId === "all" ? undefined : eq(flowClientCards.fieldId, fieldId)));
    },

    async endChat(chatId, { reason, at }) {
      await ready;
      await db
        .update(flowChats)
        .set({ endedAt: new Date(at), endReason: reason, dueAt: null, dueExitId: null, dueBranchHead: null, leaseUntil: null, leaseOwner: null })
        .where(and(eq(flowChats.chatId, chatId), isNull(flowChats.endedAt)));
      const row = await getChat(chatId);
      return row ? toRecord(row) : null;
    },
    async setPause(chatId, until) {
      await ready;
      const [row] = await db
        .update(flowChats)
        .set({ pausedUntil: until === null ? null : new Date(until) })
        .where(eq(flowChats.chatId, chatId))
        .returning();
      return row ? toRecord(row) : null;
    },
    async setWindowClosed(chatId, closed) {
      await ready;
      await db.update(flowChats).set({ windowClosed: closed }).where(eq(flowChats.chatId, chatId));
    },
    async setDayClosed(chatId, day) {
      await ready;
      await db.update(flowChats).set({ dayClosedOn: day === null ? null : withoutNul(day) }).where(eq(flowChats.chatId, chatId));
    },
    async setDelivery(chatId, delivery) {
      await ready;
      const clean = delivery === null ? null : withoutNul({ ...delivery, retryAt: toIso(new Date(delivery.retryAt)) });
      await db.update(flowChats).set({ delivery: clean }).where(eq(flowChats.chatId, chatId));
    },

    async readTimeZone(ownerId) {
      await ready;
      const [row] = await db.select({ timeZone: flowPeople.timeZone }).from(flowPeople).where(eq(flowPeople.ownerId, ownerId));
      return row?.timeZone ?? null;
    },
    async writeTimeZone(ownerId, timeZone, at) {
      await ready;
      const clean = withoutNul({ ownerId, timeZone });
      await db
        .insert(flowPeople)
        .values({ ...clean, updatedAt: new Date(at) })
        .onConflictDoUpdate({ target: flowPeople.ownerId, set: { timeZone: clean.timeZone, updatedAt: new Date(at) } });
    },

    async forgetSideTasks(ownerId) {
      await ready;
      await db.delete(flowSideTasks).where(eq(flowSideTasks.ownerId, ownerId));
    },
    async readSideTasks(ownerId, chatId) {
      await ready;
      const rows = await db
        .select()
        .from(flowSideTasks)
        .where(and(eq(flowSideTasks.ownerId, ownerId), or(eq(flowSideTasks.chatId, ""), eq(flowSideTasks.chatId, chatId))));
      return rows.map(toSideTask).sort((left, right) => compareText(left.taskId, right.taskId));
    },
    async noteSideTask(input) {
      await ready;
      const clean = withoutNul(input);
      const asked = clean.status === "asked";
      const doneAt = asked ? null : new Date(clean.at);
      const [row] = await db
        .insert(flowSideTasks)
        .values({ ownerId: clean.ownerId, taskId: clean.taskId, chatId: clean.chatId ?? "", asks: asked ? 1 : 0, doneAt })
        .onConflictDoUpdate({
          target: [flowSideTasks.ownerId, flowSideTasks.taskId, flowSideTasks.chatId],
          set: asked ? { asks: sql`${flowSideTasks.asks} + 1` } : { doneAt: sql`coalesce(${flowSideTasks.doneAt}, excluded.done_at)` },
        })
        .returning();
      return toSideTask(row!);
    },

    async countFirstMessages(ownerId, day) {
      await ready;
      const [row] = await db
        .select({ count: flowFirstMessages.count })
        .from(flowFirstMessages)
        .where(and(eq(flowFirstMessages.ownerId, ownerId), eq(flowFirstMessages.day, day)));
      return row?.count ?? 0;
    },
    async addFirstMessage(ownerId, day) {
      await ready;
      const [row] = await db
        .insert(flowFirstMessages)
        .values({ ownerId: withoutNul(ownerId), day, count: 1 })
        .onConflictDoUpdate({ target: [flowFirstMessages.ownerId, flowFirstMessages.day], set: { count: sql`${flowFirstMessages.count} + 1` } })
        .returning({ count: flowFirstMessages.count });
      return row!.count;
    },

    async close() {
      // Дожидаемся миграции: пул приложения можно закрывать сразу после.
      await ready.catch(() => {});
    },
  };
}
