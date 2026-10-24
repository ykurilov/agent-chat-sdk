import { and, asc, count, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migratePostgresSchema } from "@ykurilov/agent-chat-core";
import type { Pool } from "pg";
import type { ButtonAction, ClosableMessengerStore, ConversationKey, MessengerConversation, MessengerLink, PendingDelivery } from "../types";
import { MESSENGERS_MIGRATION_LOCK_KEY, MESSENGERS_MIGRATIONS_TABLE } from "./migration-settings";
import { messengerButtons, messengerConversations, messengerDeliveries, messengerLeases, messengerLinkCodes, messengerLinks, messengerMemberHits, messengerUpdates } from "./postgres-schema";

const date = (iso: string) => new Date(iso);

/**
 * Postgres не хранит символ NUL ни в тексте, ни в jsonb: запись с ним падает. Строки от мессенджера и модели (имя,
 * содержимое обновления, текст итога, действие кнопки) пишутся без него.
 */
function withoutNul<T>(value: T): T {
  if (typeof value === "string") return value.replaceAll("\u0000", "") as T;
  if (Array.isArray(value)) return value.map(withoutNul) as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([field, item]) => [withoutNul(field), withoutNul(item)])) as T;
  }
  return value;
}

/**
 * Приводит таблицы мессенджеров к последней миграции. Схема `agent_chat` создаётся под общей блокировкой всех пакетов, миграции — под своей:
 * копии пакета ждут друг друга, а разные пакеты стартуют разом на пустой базе без гонки за схему.
 */
export async function migrateMessengersToLatest(pool: Pool, migrationsFolder: string): Promise<void> {
  await migratePostgresSchema({
    connect: () => pool.connect(),
    lockKey: MESSENGERS_MIGRATION_LOCK_KEY,
    migrate: (client) => migrate(drizzle(client), { migrationsFolder, migrationsSchema: "agent_chat", migrationsTable: MESSENGERS_MIGRATIONS_TABLE }),
  });
}

/** Хранилище мессенджеров в PostgreSQL (схема `agent_chat`). Одноразовое берётся одним условным запросом. Закрытие закрывает пул, повторное — ничего не делает. */
export function createPostgresMessengerStore(pool: Pool): ClosableMessengerStore {
  const db = drizzle(pool);
  let closing: Promise<void> | undefined;

  const conversationIs = (key: ConversationKey) =>
    and(eq(messengerConversations.messenger, key.messenger), eq(messengerConversations.botId, key.botId), eq(messengerConversations.externalChatId, key.externalChatId));

  return {
    guarded: true,
    async saveLinkCode(code) {
      await db.insert(messengerLinkCodes).values({ codeHash: code.codeHash, userId: code.userId, messenger: code.messenger, expiresAt: date(code.expiresAt) });
    },
    async consumeLinkCode(codeHash, messenger, now) {
      const [row] = await db
        .update(messengerLinkCodes)
        .set({ usedAt: date(now) })
        .where(
          and(
            eq(messengerLinkCodes.codeHash, codeHash),
            eq(messengerLinkCodes.messenger, messenger),
            isNull(messengerLinkCodes.usedAt),
            gt(messengerLinkCodes.expiresAt, date(now)),
          ),
        )
        .returning({ userId: messengerLinkCodes.userId });
      return row ?? null;
    },
    async saveLink(link) {
      const values = withoutNul({ ...link, username: link.username ?? null, linkedAt: date(link.linkedAt) });
      await db
        .insert(messengerLinks)
        .values(values)
        .onConflictDoUpdate({ target: [messengerLinks.messenger, messengerLinks.botId, messengerLinks.externalUserId], set: values });
    },
    async saveLinkIfFree(link) {
      const values = withoutNul({ ...link, username: link.username ?? null, linkedAt: date(link.linkedAt) });
      // Чужую привязку условие не обновляет: строки в RETURNING нет — значит, аккаунт занят.
      const [row] = await db
        .insert(messengerLinks)
        .values(values)
        .onConflictDoUpdate({ target: [messengerLinks.messenger, messengerLinks.botId, messengerLinks.externalUserId], set: values, setWhere: eq(messengerLinks.userId, values.userId) })
        .returning({ userId: messengerLinks.userId });
      return row ? "saved" : "taken";
    },
    async findLink(messenger, botId, externalUserId) {
      const [row] = await db
        .select()
        .from(messengerLinks)
        .where(and(eq(messengerLinks.messenger, messenger), eq(messengerLinks.botId, botId), eq(messengerLinks.externalUserId, externalUserId)));
      return row ? toLink(row) : null;
    },
    async listLinks(userId) {
      return (await db.select().from(messengerLinks).where(eq(messengerLinks.userId, userId)).orderBy(asc(messengerLinks.linkedAt))).map(toLink);
    },
    async removeLinks(userId, messenger) {
      await db.delete(messengerLinks).where(and(eq(messengerLinks.userId, userId), eq(messengerLinks.messenger, messenger)));
    },
    async getConversation(key) {
      const [row] = await db.select().from(messengerConversations).where(conversationIs(key));
      return row ? toConversation(row) : null;
    },
    async saveConversation(conversation) {
      const values = {
        ...conversation,
        connectedBy: conversation.connectedBy ?? null,
        currentChatId: conversation.currentChatId ?? null,
        createdAt: date(conversation.createdAt),
        updatedAt: date(conversation.updatedAt),
      };
      await db
        .insert(messengerConversations)
        .values(values)
        .onConflictDoUpdate({ target: [messengerConversations.messenger, messengerConversations.botId, messengerConversations.externalChatId], set: values });
    },
    async setCurrentChat(key, chatId, at) {
      await db.update(messengerConversations).set({ currentChatId: chatId, updatedAt: date(at) }).where(conversationIs(key));
    },
    async setBlocked(key, blocked, at) {
      await db.update(messengerConversations).set({ blocked, updatedAt: date(at) }).where(conversationIs(key));
    },
    async setActive(key, active, at) {
      await db.update(messengerConversations).set({ active, updatedAt: date(at) }).where(conversationIs(key));
    },
    async listConversationsOfChat(chatId) {
      return (await db.select().from(messengerConversations).where(eq(messengerConversations.currentChatId, chatId))).map(toConversation);
    },
    async listConversationsOfUser(userId) {
      return (await db.select().from(messengerConversations).where(eq(messengerConversations.userId, userId))).map(toConversation);
    },
    async addMemberHit(hit) {
      await db
        .insert(messengerMemberHits)
        .values({ ...hit, at: date(hit.at) })
        .onConflictDoNothing();
    },
    async countMemberHits(key, externalUserId, since) {
      const [row] = await db
        .select({ value: count() })
        .from(messengerMemberHits)
        .where(
          and(
            eq(messengerMemberHits.messenger, key.messenger),
            eq(messengerMemberHits.botId, key.botId),
            eq(messengerMemberHits.externalChatId, key.externalChatId),
            eq(messengerMemberHits.externalUserId, externalUserId),
            gte(messengerMemberHits.at, date(since)),
          ),
        );
      return Number(row?.value ?? 0);
    },
    async claimUpdate(key, now, work) {
      const content = work && { messenger: work.messenger, botId: work.botId, payload: withoutNul(work.update), holder: work.holder, leaseUntil: date(work.leaseUntil) };
      const rows = await db
        .insert(messengerUpdates)
        .values({ key, status: "received", receivedAt: date(now), ...content })
        .onConflictDoNothing()
        .returning({ key: messengerUpdates.key });
      return rows.length === 1;
    },
    async finishUpdate(key, status, now, holder) {
      const stillHeld = holder === undefined ? undefined : and(eq(messengerUpdates.holder, holder), eq(messengerUpdates.status, "received"));
      await db
        .update(messengerUpdates)
        .set({ status, finishedAt: date(now), payload: null, holder: null, leaseUntil: null })
        .where(and(eq(messengerUpdates.key, key), stillHeld));
    },
    async renewUpdates(keys, holder, leaseUntil) {
      if (keys.length === 0) return;
      await db
        .update(messengerUpdates)
        .set({ leaseUntil: date(leaseUntil) })
        .where(and(inArray(messengerUpdates.key, [...keys]), eq(messengerUpdates.holder, holder), eq(messengerUpdates.status, "received")));
    },
    async releaseUpdate(key, holder, retryAt) {
      await db
        .update(messengerUpdates)
        .set({ holder: "", leaseUntil: date(retryAt) })
        .where(and(eq(messengerUpdates.key, key), eq(messengerUpdates.holder, holder), eq(messengerUpdates.status, "received")));
    },
    async takeAbandonedUpdates(bot, holder, now, leaseUntil, limit) {
      const abandoned = and(
        eq(messengerUpdates.messenger, bot.messenger),
        eq(messengerUpdates.botId, bot.botId),
        eq(messengerUpdates.status, "received"),
        lte(messengerUpdates.leaseUntil, date(now)),
      );
      // Как у итогов: занятые другой копией строки пропускаются, выбор — отдельным шагом (WITH).
      const oldest = db
        .$with("oldest_updates")
        .as(db.select({ key: messengerUpdates.key }).from(messengerUpdates).where(abandoned).orderBy(asc(messengerUpdates.receivedAt), asc(messengerUpdates.key)).limit(limit).for("update", { skipLocked: true }));
      const rows = await db
        .with(oldest)
        .update(messengerUpdates)
        .set({ holder, leaseUntil: date(leaseUntil), attempts: sql`${messengerUpdates.attempts} + 1` })
        .where(inArray(messengerUpdates.key, db.select({ key: oldest.key }).from(oldest)))
        .returning({ key: messengerUpdates.key, update: messengerUpdates.payload, receivedAt: messengerUpdates.receivedAt, attempts: messengerUpdates.attempts });
      return rows
        .sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime() || (left.key < right.key ? -1 : 1))
        .map(({ key, update, receivedAt, attempts }) => ({ key, update, receivedAt: receivedAt.toISOString(), attempts }));
    },
    async saveButton(button) {
      await db
        .insert(messengerButtons)
        .values({ id: button.id, messenger: button.messenger, botId: button.botId, externalChatId: button.externalChatId, action: withoutNul(button.action), createdAt: date(button.createdAt) });
    },
    async takeButton(key, id, now) {
      const [row] = await db
        .update(messengerButtons)
        .set({ usedAt: date(now) })
        .where(
          and(
            eq(messengerButtons.id, id),
            eq(messengerButtons.messenger, key.messenger),
            eq(messengerButtons.botId, key.botId),
            eq(messengerButtons.externalChatId, key.externalChatId),
            isNull(messengerButtons.usedAt),
          ),
        )
        .returning({ action: messengerButtons.action });
      return row ? (row.action as ButtonAction) : null;
    },
    async savePendingDelivery(delivery, holder, leaseUntil) {
      const { id, messenger, botId, externalChatId, createdAt, ...payload } = delivery;
      const values = { id, messenger, botId, externalChatId, payload: withoutNul(payload), holder, leaseUntil: date(leaseUntil), createdAt: date(createdAt) };
      await db.insert(messengerDeliveries).values(values).onConflictDoUpdate({ target: messengerDeliveries.id, set: values });
    },
    async deletePendingDelivery(id) {
      await db.delete(messengerDeliveries).where(eq(messengerDeliveries.id, id));
    },
    async renewPendingDeliveries(holder, leaseUntil) {
      await db.update(messengerDeliveries).set({ leaseUntil: date(leaseUntil) }).where(eq(messengerDeliveries.holder, holder));
    },
    async takeAbandonedDeliveries(bot, holder, now, leaseUntil, limit) {
      const abandoned = and(eq(messengerDeliveries.messenger, bot.messenger), eq(messengerDeliveries.botId, bot.botId), lte(messengerDeliveries.leaseUntil, date(now)));
      // Строки, которые уже забирает другая копия, пропускаются: каждая достаётся одной. Выбор — отдельным шагом (WITH),
      // иначе PostgreSQL может пересчитать LIMIT по ходу обновления.
      const oldest = db
        .$with("oldest")
        .as(db.select({ id: messengerDeliveries.id }).from(messengerDeliveries).where(abandoned).orderBy(asc(messengerDeliveries.seq)).limit(limit).for("update", { skipLocked: true }));
      const rows = await db
        .with(oldest)
        .update(messengerDeliveries)
        .set({ holder, leaseUntil: date(leaseUntil) })
        .where(inArray(messengerDeliveries.id, db.select({ id: oldest.id }).from(oldest)))
        .returning();
      return rows.sort((left, right) => left.seq - right.seq).map(toDelivery);
    },
    async acquireLease(name, holder, leaseUntil, now) {
      const rows = await db
        .insert(messengerLeases)
        .values({ name, holder, leaseUntil: date(leaseUntil) })
        .onConflictDoUpdate({
          target: messengerLeases.name,
          set: { holder, leaseUntil: date(leaseUntil) },
          setWhere: or(eq(messengerLeases.holder, holder), lte(messengerLeases.leaseUntil, date(now))),
        })
        .returning({ name: messengerLeases.name });
      return rows.length === 1;
    },
    async releaseLease(name, holder) {
      await db.delete(messengerLeases).where(and(eq(messengerLeases.name, name), eq(messengerLeases.holder, holder)));
    },
    async purgeBefore(before) {
      const cutoff = date(before);
      await db.transaction(async (tx) => {
        await tx.delete(messengerLinkCodes).where(lt(messengerLinkCodes.expiresAt, cutoff));
        // Обновление с живой арендой не убирается: его ещё подберут или бросят. Аренда, истёкшая раньше срока хранения, —
        // забытое обновление (например, бот убран из настроек): его уже никто не подберёт.
        await tx.delete(messengerUpdates).where(and(lt(messengerUpdates.receivedAt, cutoff), or(isNull(messengerUpdates.holder), lt(messengerUpdates.leaseUntil, cutoff))));
        await tx.delete(messengerButtons).where(lt(messengerButtons.createdAt, cutoff));
        await tx.delete(messengerMemberHits).where(lt(messengerMemberHits.at, cutoff));
      });
    },
    close() {
      closing ??= pool.end();
      return closing;
    },
  };
}

function toLink(row: typeof messengerLinks.$inferSelect): MessengerLink {
  const { username, linkedAt, ...rest } = row;
  return { ...rest, ...(username !== null && { username }), linkedAt: linkedAt.toISOString() };
}

function toConversation(row: typeof messengerConversations.$inferSelect): MessengerConversation {
  const { connectedBy, currentChatId, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    ...(connectedBy !== null && { connectedBy }),
    ...(currentChatId !== null && { currentChatId }),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

function toDelivery(row: typeof messengerDeliveries.$inferSelect): PendingDelivery {
  return {
    id: row.id,
    messenger: row.messenger,
    botId: row.botId,
    externalChatId: row.externalChatId,
    ...(row.payload as Omit<PendingDelivery, "id" | "createdAt" | keyof ConversationKey>),
    createdAt: row.createdAt.toISOString(),
  };
}
