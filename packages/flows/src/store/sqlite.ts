import Database from "better-sqlite3";
import { and, asc, eq, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { StateMap } from "../engine/migrate-run";
import type { FlowChatRecord, FlowStore, PendingFlowChange, SideTaskRecord } from "./flow-store";
import { appliedInTime, byVersionAndState, compareText, migratePending, pendingAdded } from "./flow-store-shared";
import { FLOWS_MIGRATIONS_TABLE } from "./migration-settings";
import { flowChats, flowClientCards, flowFirstMessages, flowPeople, flowSideTasks, flowVersions } from "./sqlite-schema";

/** Хранилище в файле SQLite: `close` обязателен — файл закрывает приложение при остановке. */
export type SqliteFlowStore = FlowStore & Required<Pick<FlowStore, "close">>;

type ChatRow = typeof flowChats.$inferSelect;

const toMs = (iso: string) => Date.parse(iso);
const toIso = (ms: number) => new Date(ms).toISOString();

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

/** Дописать изменение в конец `pending`, если такого ключа там ещё нет. Одно выражение — одна запись базы. */
const pendingWith = (change: PendingFlowChange): SQL =>
  sql`case when exists (select 1 from json_each(${flowChats.pending}) where json_extract(value, '$.key') = ${change.key})
    then ${flowChats.pending} else json_insert(${flowChats.pending}, '$[#]', json(${JSON.stringify(change)})) end`;

/** Состояние по карте перевода: удалённые — в выбранные, остальные как были. */
function mappedStateSql(map: StateMap): SQL {
  const entries = Object.entries(map);
  if (entries.length === 0) return sql`${flowChats.stateId}`;
  const cases = entries.map(([from, to]) => sql`when ${from} then ${to}`);
  return sql`case ${flowChats.stateId} ${sql.join(cases, sql` `)} else ${flowChats.stateId} end`;
}

/** Таймер наступил, никто его не держит, разговор идёт и не на паузе. Аренда до `lease_until` включительно ещё живая. */
const dueAndFree = (now: number) =>
  and(
    lte(flowChats.dueAt, now),
    or(isNull(flowChats.leaseUntil), lt(flowChats.leaseUntil, now)),
    isNull(flowChats.endedAt),
    or(isNull(flowChats.pausedUntil), lte(flowChats.pausedUntil, now)),
  );

/**
 * Сценарии в файле SQLite. Схема приводится к последней миграции при открытии; файл может быть общим с хранилищем
 * чатов. Несколько копий сервера на одном файле делят таймеры арендой: каждое изменение — одно условное `update`
 * или короткая транзакция с захватом записи (`immediate`).
 */
export function createSqliteFlowStore(filePath: string, migrationsFolder: string): SqliteFlowStore {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder, migrationsTable: FLOWS_MIGRATIONS_TABLE });

  const getChat = (chatId: string) => db.select().from(flowChats).where(eq(flowChats.chatId, chatId)).get();

  return {
    async pinChat(input) {
      db.insert(flowChats)
        .values({
          chatId: input.chatId,
          ownerId: input.ownerId,
          flowId: input.flowId,
          versionId: input.versionId,
          stateId: input.stateId,
          pending: [],
          timeZone: input.timeZone,
          ...(input.placement && { placement: input.placement }),
          updatedAt: toMs(input.at),
        })
        .onConflictDoNothing()
        .run();
      return toRecord(getChat(input.chatId)!);
    },
    async getChat(chatId) {
      const row = getChat(chatId);
      return row ? toRecord(row) : null;
    },
    async updateChat(chatId, patch, at) {
      const row = db
        .update(flowChats)
        .set({ versionId: patch.versionId, stateId: patch.stateId, timeZone: patch.timeZone, placement: patch.placement, updatedAt: toMs(at) })
        .where(eq(flowChats.chatId, chatId))
        .returning()
        .get();
      return row ? toRecord(row) : null;
    },
    async deleteChat(chatId) {
      db.delete(flowChats).where(eq(flowChats.chatId, chatId)).run();
    },

    async addPending(chatId, change) {
      // Прочитать и дописать под захватом записи: две копии с одним ключом не дают двух записей.
      const add = sqlite.transaction(() => {
        const row = db.select({ pending: flowChats.pending }).from(flowChats).where(eq(flowChats.chatId, chatId)).get();
        const next = row && pendingAdded(row.pending, change);
        if (next) db.update(flowChats).set({ pending: next }).where(eq(flowChats.chatId, chatId)).run();
      });
      add.immediate();
    },
    async takePending(chatId) {
      // Прочитать и очистить под захватом записи: вторая копия ждёт и видит уже пустой список (кроме применённых в срок).
      const take = sqlite.transaction(() => {
        const row = db.select({ pending: flowChats.pending }).from(flowChats).where(eq(flowChats.chatId, chatId)).get();
        if (!row || row.pending.length === 0) return [];
        db.update(flowChats).set({ pending: row.pending.filter(appliedInTime) }).where(eq(flowChats.chatId, chatId)).run();
        return row.pending;
      });
      return take.immediate();
    },

    async setDue(chatId, due, options) {
      db.update(flowChats)
        .set({
          dueAt: due ? toMs(due.at) : null,
          dueExitId: due?.exitId ?? null,
          dueBranchHead: due?.branchHead ?? null,
          leaseUntil: null,
          leaseOwner: null,
        })
        .where(and(eq(flowChats.chatId, chatId), options?.unlessDelivery ? isNull(flowChats.delivery) : undefined))
        .run();
    },
    async leaseDue({ now, owner, leaseMs, limit }) {
      const nowMs = toMs(now);
      // Выбор и аренда — одно `update`: из двух копий, пришедших одновременно, строку получит только первая.
      const due = db
        .select({ chatId: flowChats.chatId })
        .from(flowChats)
        .where(dueAndFree(nowMs))
        .orderBy(asc(flowChats.dueAt), asc(flowChats.chatId))
        .limit(limit);
      const rows = db
        .update(flowChats)
        .set({ leaseOwner: owner, leaseUntil: nowMs + leaseMs })
        .where(and(inArray(flowChats.chatId, due), dueAndFree(nowMs)))
        .returning()
        .all();
      return rows.map(toRecord).sort((left, right) => compareText(left.dueAt!, right.dueAt!) || compareText(left.chatId, right.chatId));
    },
    async releaseLease(chatId, owner) {
      db.update(flowChats)
        .set({ leaseOwner: null, leaseUntil: null })
        .where(and(eq(flowChats.chatId, chatId), eq(flowChats.leaseOwner, owner)))
        .run();
    },
    async renewLease({ chatId, owner, now, leaseMs }) {
      const renewed = db
        .update(flowChats)
        .set({ leaseUntil: toMs(now) + leaseMs })
        .where(and(eq(flowChats.chatId, chatId), eq(flowChats.leaseOwner, owner)))
        .returning({ chatId: flowChats.chatId })
        .all();
      return renewed.length > 0;
    },

    async saveVersion(input) {
      const inserted = db
        .insert(flowVersions)
        .values({ flowId: input.flowId, versionId: input.versionId, hash: input.hash, flow: input.flow, createdAt: toMs(input.at) })
        .onConflictDoNothing()
        .returning({ hash: flowVersions.hash })
        .all();
      if (inserted.length > 0) return "new";
      const saved = db
        .select({ hash: flowVersions.hash })
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, input.flowId), eq(flowVersions.versionId, input.versionId)))
        .get();
      return saved?.hash === input.hash ? "same" : "conflict";
    },
    async getVersion(flowId, versionId) {
      const row = db
        .select()
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.versionId, versionId)))
        .get();
      return row ? { ...row, createdAt: toIso(row.createdAt) } : null;
    },

    async countChatsByState({ flowId }) {
      const rows = db
        .select({ versionId: flowChats.versionId, stateId: flowChats.stateId, chats: sql<number>`count(*)` })
        .from(flowChats)
        .where(eq(flowChats.flowId, flowId))
        .groupBy(flowChats.versionId, flowChats.stateId)
        .all();
      return rows.map((row) => ({ ...row, chats: Number(row.chats) })).sort(byVersionAndState);
    },
    async migrateBatch(input) {
      const change = migratePending(input);
      const notYetMoved = and(eq(flowChats.flowId, input.flowId), ne(flowChats.versionId, input.toVersionId));
      const batch = db.select({ chatId: flowChats.chatId }).from(flowChats).where(notYetMoved).orderBy(asc(flowChats.chatId)).limit(input.limit);
      const moved = db
        .update(flowChats)
        .set({ versionId: input.toVersionId, stateId: mappedStateSql(input.map), pending: pendingWith(change), updatedAt: toMs(input.at) })
        .where(and(inArray(flowChats.chatId, batch), notYetMoved))
        .returning({ chatId: flowChats.chatId })
        .all();
      return { moved: moved.map((row) => row.chatId) };
    },

    async readCard(ownerId) {
      const rows = db.select().from(flowClientCards).where(eq(flowClientCards.ownerId, ownerId)).all();
      return rows
        .map((row) => ({ fieldId: row.fieldId, value: row.value, updatedAt: toIso(row.updatedAt), chatId: row.chatId, flowId: row.flowId }))
        .sort((left, right) => compareText(left.fieldId, right.fieldId));
    },
    async writeCardField(input) {
      const entry = { value: input.value, updatedAt: toMs(input.at), chatId: input.chatId, flowId: input.flowId };
      db.insert(flowClientCards)
        .values({ ownerId: input.ownerId, fieldId: input.fieldId, ...entry })
        .onConflictDoUpdate({ target: [flowClientCards.ownerId, flowClientCards.fieldId], set: entry })
        .run();
    },
    async forgetCard(ownerId, fieldId) {
      db.delete(flowClientCards)
        .where(and(eq(flowClientCards.ownerId, ownerId), fieldId === "all" ? undefined : eq(flowClientCards.fieldId, fieldId)))
        .run();
    },

    async endChat(chatId, { reason, at }) {
      db.update(flowChats)
        .set({ endedAt: toMs(at), endReason: reason, dueAt: null, dueExitId: null, dueBranchHead: null, leaseUntil: null, leaseOwner: null })
        .where(and(eq(flowChats.chatId, chatId), isNull(flowChats.endedAt)))
        .run();
      const row = getChat(chatId);
      return row ? toRecord(row) : null;
    },
    async setPause(chatId, until) {
      const row = db
        .update(flowChats)
        .set({ pausedUntil: until === null ? null : toMs(until) })
        .where(eq(flowChats.chatId, chatId))
        .returning()
        .get();
      return row ? toRecord(row) : null;
    },
    async setWindowClosed(chatId, closed) {
      db.update(flowChats).set({ windowClosed: closed }).where(eq(flowChats.chatId, chatId)).run();
    },
    async setDayClosed(chatId, day) {
      db.update(flowChats).set({ dayClosedOn: day }).where(eq(flowChats.chatId, chatId)).run();
    },
    async setDelivery(chatId, delivery) {
      const clean = delivery === null ? null : { ...delivery, retryAt: toIso(toMs(delivery.retryAt)) };
      db.update(flowChats).set({ delivery: clean }).where(eq(flowChats.chatId, chatId)).run();
    },

    async readTimeZone(ownerId) {
      return db.select({ timeZone: flowPeople.timeZone }).from(flowPeople).where(eq(flowPeople.ownerId, ownerId)).get()?.timeZone ?? null;
    },
    async writeTimeZone(ownerId, timeZone, at) {
      db.insert(flowPeople)
        .values({ ownerId, timeZone, updatedAt: toMs(at) })
        .onConflictDoUpdate({ target: flowPeople.ownerId, set: { timeZone, updatedAt: toMs(at) } })
        .run();
    },

    async readSideTasks(ownerId, chatId) {
      const rows = db
        .select()
        .from(flowSideTasks)
        .where(and(eq(flowSideTasks.ownerId, ownerId), or(eq(flowSideTasks.chatId, ""), eq(flowSideTasks.chatId, chatId))))
        .all();
      return rows.map(toSideTask).sort((left, right) => compareText(left.taskId, right.taskId));
    },
    async forgetSideTasks(ownerId) {
      db.delete(flowSideTasks).where(eq(flowSideTasks.ownerId, ownerId)).run();
    },
    async noteSideTask(input) {
      const asked = input.status === "asked";
      const doneAt = asked ? null : toMs(input.at);
      const row = db
        .insert(flowSideTasks)
        .values({ ownerId: input.ownerId, taskId: input.taskId, chatId: input.chatId ?? "", asks: asked ? 1 : 0, doneAt })
        .onConflictDoUpdate({
          target: [flowSideTasks.ownerId, flowSideTasks.taskId, flowSideTasks.chatId],
          set: asked ? { asks: sql`${flowSideTasks.asks} + 1` } : { doneAt: sql`coalesce(${flowSideTasks.doneAt}, ${doneAt})` },
        })
        .returning()
        .get();
      return toSideTask(row!);
    },

    async countFirstMessages(ownerId, day) {
      const row = db
        .select({ count: flowFirstMessages.count })
        .from(flowFirstMessages)
        .where(and(eq(flowFirstMessages.ownerId, ownerId), eq(flowFirstMessages.day, day)))
        .get();
      return row?.count ?? 0;
    },
    async addFirstMessage(ownerId, day) {
      const row = db
        .insert(flowFirstMessages)
        .values({ ownerId, day, count: 1 })
        .onConflictDoUpdate({ target: [flowFirstMessages.ownerId, flowFirstMessages.day], set: { count: sql`${flowFirstMessages.count} + 1` } })
        .returning({ count: flowFirstMessages.count })
        .get();
      return row!.count;
    },

    async close() {
      if (sqlite.open) sqlite.close();
    },
  };
}
