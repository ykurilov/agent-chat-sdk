import type Database from "better-sqlite3";
import { and, asc, count, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { ButtonAction, ClosableMessengerStore, ConversationKey, MessengerConversation, MessengerLink, PendingDelivery } from "../types";
import { MESSENGERS_MIGRATIONS_TABLE } from "./migration-settings";
import { messengerButtons, messengerConversations, messengerDeliveries, messengerLeases, messengerLinkCodes, messengerLinks, messengerMemberHits, messengerUpdates } from "./sqlite-schema";

const ms = (iso: string) => Date.parse(iso);
const iso = (time: number) => new Date(time).toISOString();

/** Хранилище мессенджеров в SQLite. Одноразовое (код, кнопка, обновление, аренда) берётся одним условным запросом. */
export function createSqliteMessengerStore(sqlite: Database.Database, migrationsFolder: string): ClosableMessengerStore {
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder, migrationsTable: MESSENGERS_MIGRATIONS_TABLE });

  const conversationIs = (key: ConversationKey) =>
    and(eq(messengerConversations.messenger, key.messenger), eq(messengerConversations.botId, key.botId), eq(messengerConversations.externalChatId, key.externalChatId));

  return {
    guarded: true,
    async saveLinkCode(code) {
      db.insert(messengerLinkCodes).values({ codeHash: code.codeHash, userId: code.userId, messenger: code.messenger, expiresAt: ms(code.expiresAt) }).run();
    },
    async consumeLinkCode(codeHash, messenger, now) {
      const row = db
        .update(messengerLinkCodes)
        .set({ usedAt: ms(now) })
        .where(
          and(
            eq(messengerLinkCodes.codeHash, codeHash),
            eq(messengerLinkCodes.messenger, messenger),
            isNull(messengerLinkCodes.usedAt),
            gt(messengerLinkCodes.expiresAt, ms(now)),
          ),
        )
        .returning({ userId: messengerLinkCodes.userId })
        .get();
      return row ?? null;
    },
    async saveLink(link) {
      const values = { ...link, username: link.username ?? null, linkedAt: ms(link.linkedAt) };
      db.insert(messengerLinks)
        .values(values)
        .onConflictDoUpdate({ target: [messengerLinks.messenger, messengerLinks.botId, messengerLinks.externalUserId], set: values })
        .run();
    },
    async saveLinkIfFree(link) {
      const values = { ...link, username: link.username ?? null, linkedAt: ms(link.linkedAt) };
      // Чужую привязку условие не обновляет: строки в RETURNING нет — значит, аккаунт занят.
      const row = db
        .insert(messengerLinks)
        .values(values)
        .onConflictDoUpdate({ target: [messengerLinks.messenger, messengerLinks.botId, messengerLinks.externalUserId], set: values, setWhere: eq(messengerLinks.userId, values.userId) })
        .returning({ userId: messengerLinks.userId })
        .get();
      return row ? "saved" : "taken";
    },
    async findLink(messenger, botId, externalUserId) {
      const row = db
        .select()
        .from(messengerLinks)
        .where(and(eq(messengerLinks.messenger, messenger), eq(messengerLinks.botId, botId), eq(messengerLinks.externalUserId, externalUserId)))
        .get();
      return row ? toLink(row) : null;
    },
    async listLinks(userId) {
      return db.select().from(messengerLinks).where(eq(messengerLinks.userId, userId)).orderBy(asc(messengerLinks.linkedAt)).all().map(toLink);
    },
    async removeLinks(userId, messenger) {
      db.delete(messengerLinks).where(and(eq(messengerLinks.userId, userId), eq(messengerLinks.messenger, messenger))).run();
    },
    async getConversation(key) {
      const row = db.select().from(messengerConversations).where(conversationIs(key)).get();
      return row ? toConversation(row) : null;
    },
    async saveConversation(conversation) {
      const values = {
        ...conversation,
        connectedBy: conversation.connectedBy ?? null,
        currentChatId: conversation.currentChatId ?? null,
        createdAt: ms(conversation.createdAt),
        updatedAt: ms(conversation.updatedAt),
      };
      db.insert(messengerConversations)
        .values(values)
        .onConflictDoUpdate({ target: [messengerConversations.messenger, messengerConversations.botId, messengerConversations.externalChatId], set: values })
        .run();
    },
    async setCurrentChat(key, chatId, at) {
      db.update(messengerConversations).set({ currentChatId: chatId, updatedAt: ms(at) }).where(conversationIs(key)).run();
    },
    async setBlocked(key, blocked, at) {
      db.update(messengerConversations).set({ blocked, updatedAt: ms(at) }).where(conversationIs(key)).run();
    },
    async setActive(key, active, at) {
      db.update(messengerConversations).set({ active, updatedAt: ms(at) }).where(conversationIs(key)).run();
    },
    async listConversationsOfChat(chatId) {
      return db.select().from(messengerConversations).where(eq(messengerConversations.currentChatId, chatId)).all().map(toConversation);
    },
    async listConversationsOfUser(userId) {
      return db.select().from(messengerConversations).where(eq(messengerConversations.userId, userId)).all().map(toConversation);
    },
    async addMemberHit(hit) {
      db.insert(messengerMemberHits).values({ ...hit, at: ms(hit.at) }).onConflictDoNothing().run();
    },
    async countMemberHits(key, externalUserId, since) {
      const row = db
        .select({ value: count() })
        .from(messengerMemberHits)
        .where(
          and(
            eq(messengerMemberHits.messenger, key.messenger),
            eq(messengerMemberHits.botId, key.botId),
            eq(messengerMemberHits.externalChatId, key.externalChatId),
            eq(messengerMemberHits.externalUserId, externalUserId),
            gte(messengerMemberHits.at, ms(since)),
          ),
        )
        .get();
      return row?.value ?? 0;
    },
    async claimUpdate(key, now, work) {
      const content = work && { messenger: work.messenger, botId: work.botId, payload: work.update, holder: work.holder, leaseUntil: ms(work.leaseUntil) };
      return db.insert(messengerUpdates).values({ key, status: "received", receivedAt: ms(now), ...content }).onConflictDoNothing().run().changes === 1;
    },
    async finishUpdate(key, status, now, holder) {
      const stillHeld = holder === undefined ? undefined : and(eq(messengerUpdates.holder, holder), eq(messengerUpdates.status, "received"));
      db.update(messengerUpdates)
        .set({ status, finishedAt: ms(now), payload: null, holder: null, leaseUntil: null })
        .where(and(eq(messengerUpdates.key, key), stillHeld))
        .run();
    },
    async renewUpdates(keys, holder, leaseUntil) {
      if (keys.length === 0) return;
      db.update(messengerUpdates)
        .set({ leaseUntil: ms(leaseUntil) })
        .where(and(inArray(messengerUpdates.key, [...keys]), eq(messengerUpdates.holder, holder), eq(messengerUpdates.status, "received")))
        .run();
    },
    async releaseUpdate(key, holder, retryAt) {
      db.update(messengerUpdates)
        .set({ holder: "", leaseUntil: ms(retryAt) })
        .where(and(eq(messengerUpdates.key, key), eq(messengerUpdates.holder, holder), eq(messengerUpdates.status, "received")))
        .run();
    },
    async takeAbandonedUpdates(bot, holder, now, leaseUntil, limit) {
      const abandoned = and(
        eq(messengerUpdates.messenger, bot.messenger),
        eq(messengerUpdates.botId, bot.botId),
        eq(messengerUpdates.status, "received"),
        lte(messengerUpdates.leaseUntil, ms(now)),
      );
      const oldest = db.select({ key: messengerUpdates.key }).from(messengerUpdates).where(abandoned).orderBy(asc(messengerUpdates.receivedAt), sql`rowid`).limit(limit);
      return db
        .update(messengerUpdates)
        .set({ holder, leaseUntil: ms(leaseUntil), attempts: sql`${messengerUpdates.attempts} + 1` })
        .where(and(inArray(messengerUpdates.key, oldest), abandoned))
        .returning({ key: messengerUpdates.key, update: messengerUpdates.payload, receivedAt: messengerUpdates.receivedAt, attempts: messengerUpdates.attempts, order: sql<number>`rowid` })
        .all()
        .sort((left, right) => left.receivedAt - right.receivedAt || left.order - right.order)
        .map(({ key, update, receivedAt, attempts }) => ({ key, update, receivedAt: iso(receivedAt), attempts }));
    },
    async saveButton(button) {
      db.insert(messengerButtons)
        .values({ id: button.id, messenger: button.messenger, botId: button.botId, externalChatId: button.externalChatId, action: button.action, createdAt: ms(button.createdAt) })
        .run();
    },
    async takeButton(key, id, now) {
      const row = db
        .update(messengerButtons)
        .set({ usedAt: ms(now) })
        .where(
          and(
            eq(messengerButtons.id, id),
            eq(messengerButtons.messenger, key.messenger),
            eq(messengerButtons.botId, key.botId),
            eq(messengerButtons.externalChatId, key.externalChatId),
            isNull(messengerButtons.usedAt),
          ),
        )
        .returning({ action: messengerButtons.action })
        .get();
      return row ? (row.action as ButtonAction) : null;
    },
    async savePendingDelivery(delivery, holder, leaseUntil) {
      const { id, messenger, botId, externalChatId, createdAt, ...payload } = delivery;
      const values = { id, messenger, botId, externalChatId, payload, holder, leaseUntil: ms(leaseUntil), createdAt: ms(createdAt) };
      db.insert(messengerDeliveries).values(values).onConflictDoUpdate({ target: messengerDeliveries.id, set: values }).run();
    },
    async deletePendingDelivery(id) {
      db.delete(messengerDeliveries).where(eq(messengerDeliveries.id, id)).run();
    },
    async renewPendingDeliveries(holder, leaseUntil) {
      db.update(messengerDeliveries).set({ leaseUntil: ms(leaseUntil) }).where(eq(messengerDeliveries.holder, holder)).run();
    },
    async takeAbandonedDeliveries(bot, holder, now, leaseUntil, limit) {
      const abandoned = and(eq(messengerDeliveries.messenger, bot.messenger), eq(messengerDeliveries.botId, bot.botId), lte(messengerDeliveries.leaseUntil, ms(now)));
      const oldest = db.select({ id: messengerDeliveries.id }).from(messengerDeliveries).where(abandoned).orderBy(sql`rowid`).limit(limit);
      return db
        .update(messengerDeliveries)
        .set({ holder, leaseUntil: ms(leaseUntil) })
        .where(and(inArray(messengerDeliveries.id, oldest), abandoned))
        .returning({ row: messengerDeliveries, order: sql<number>`rowid` })
        .all()
        .sort((left, right) => left.order - right.order)
        .map(({ row }) => toDelivery(row));
    },
    async acquireLease(name, holder, leaseUntil, now) {
      const result = db
        .insert(messengerLeases)
        .values({ name, holder, leaseUntil: ms(leaseUntil) })
        .onConflictDoUpdate({
          target: messengerLeases.name,
          set: { holder, leaseUntil: ms(leaseUntil) },
          setWhere: or(eq(messengerLeases.holder, holder), sql`${messengerLeases.leaseUntil} <= ${ms(now)}`),
        })
        .run();
      return result.changes === 1;
    },
    async releaseLease(name, holder) {
      db.delete(messengerLeases).where(and(eq(messengerLeases.name, name), eq(messengerLeases.holder, holder))).run();
    },
    async purgeBefore(before) {
      const cutoff = ms(before);
      db.transaction((tx) => {
        tx.delete(messengerLinkCodes).where(lt(messengerLinkCodes.expiresAt, cutoff)).run();
        // Обновление с живой арендой не убирается: его ещё подберут или бросят. Аренда, истёкшая раньше срока хранения, —
        // забытое обновление (например, бот убран из настроек): его уже никто не подберёт.
        tx.delete(messengerUpdates).where(and(lt(messengerUpdates.receivedAt, cutoff), or(isNull(messengerUpdates.holder), lt(messengerUpdates.leaseUntil, cutoff)))).run();
        tx.delete(messengerButtons).where(lt(messengerButtons.createdAt, cutoff)).run();
        tx.delete(messengerMemberHits).where(lt(messengerMemberHits.at, cutoff)).run();
      });
    },
    async close() {
      // Повторное закрытие у better-sqlite3 ничего не делает.
      sqlite.close();
    },
  };
}

function toLink(row: typeof messengerLinks.$inferSelect): MessengerLink {
  const { username, linkedAt, ...rest } = row;
  return { ...rest, ...(username !== null && { username }), linkedAt: iso(linkedAt) };
}

function toConversation(row: typeof messengerConversations.$inferSelect): MessengerConversation {
  const { connectedBy, currentChatId, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    ...(connectedBy !== null && { connectedBy }),
    ...(currentChatId !== null && { currentChatId }),
    createdAt: iso(createdAt),
    updatedAt: iso(updatedAt),
  };
}

function toDelivery(row: typeof messengerDeliveries.$inferSelect): PendingDelivery {
  return { id: row.id, messenger: row.messenger, botId: row.botId, externalChatId: row.externalChatId, ...(row.payload as Omit<PendingDelivery, "id" | "createdAt" | keyof ConversationKey>), createdAt: iso(row.createdAt) };
}
