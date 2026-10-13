import type { MessengerName } from "../messenger-adapter";
import type { ButtonAction, ConversationKey, MessengerConversation, MessengerLink, MessengerStore, PendingDelivery, UpdateWork } from "../types";

const conversationId = (key: ConversationKey) => `${key.messenger}\u0000${key.botId}\u0000${key.externalChatId}`;
const linkId = (messenger: MessengerName, botId: string, externalUserId: string) => `${messenger}\u0000${botId}\u0000${externalUserId}`;
const time = (iso: string) => Date.parse(iso);

/** Хранилище в памяти процесса: для тестов и одной копии сервера без базы. Всё пропадает при перезапуске. */
export function createMemoryMessengerStore(): MessengerStore {
  const codes = new Map<string, { userId: string; messenger: MessengerName; expiresAt: string; usedAt?: string }>();
  const links = new Map<string, MessengerLink>();
  const conversations = new Map<string, MessengerConversation>();
  const hits = new Map<string, ConversationKey & { externalUserId: string; at: string }>();
  /** Порядок вставки Map — порядок приёма. */
  const updates = new Map<string, { receivedAt: string; work?: Omit<UpdateWork, "holder" | "leaseUntil">; holder?: string; leaseUntil?: string; attempts: number }>();
  const buttons = new Map<string, { key: string; action: ButtonAction; createdAt: string; usedAt?: string }>();
  const leases = new Map<string, { holder: string; leaseUntil: string }>();
  /** Порядок вставки Map — порядок сохранения итогов; переписанный итог остаётся на своём месте. */
  const deliveries = new Map<string, { delivery: PendingDelivery; holder: string; leaseUntil: string }>();

  function updateConversation(key: ConversationKey, change: Partial<MessengerConversation>): void {
    const existing = conversations.get(conversationId(key));
    if (existing) conversations.set(conversationId(key), { ...existing, ...change });
  }

  return {
    async saveLinkCode(code) {
      codes.set(code.codeHash, { userId: code.userId, messenger: code.messenger, expiresAt: code.expiresAt });
    },
    async consumeLinkCode(codeHash, messenger, now) {
      const code = codes.get(codeHash);
      if (!code || code.usedAt || code.messenger !== messenger || time(code.expiresAt) <= time(now)) return null;
      code.usedAt = now;
      return { userId: code.userId };
    },
    async saveLink(link) {
      links.set(linkId(link.messenger, link.botId, link.externalUserId), structuredClone(withoutEmpty(link)));
    },
    async findLink(messenger, botId, externalUserId) {
      const link = links.get(linkId(messenger, botId, externalUserId));
      return link ? structuredClone(link) : null;
    },
    async listLinks(userId) {
      return [...links.values()].filter((link) => link.userId === userId).sort((left, right) => time(left.linkedAt) - time(right.linkedAt)).map((link) => structuredClone(link));
    },
    async removeLinks(userId, messenger) {
      for (const [id, link] of links) if (link.userId === userId && link.messenger === messenger) links.delete(id);
    },
    async getConversation(key) {
      const conversation = conversations.get(conversationId(key));
      return conversation ? structuredClone(conversation) : null;
    },
    async saveConversation(conversation) {
      conversations.set(conversationId(conversation), structuredClone(withoutEmpty(conversation)));
    },
    async setCurrentChat(key, chatId, at) {
      const existing = conversations.get(conversationId(key));
      if (!existing) return;
      const { currentChatId: _previous, ...rest } = existing;
      conversations.set(conversationId(key), chatId === null ? { ...rest, updatedAt: at } : { ...rest, currentChatId: chatId, updatedAt: at });
    },
    async setBlocked(key, blocked, at) {
      updateConversation(key, { blocked, updatedAt: at });
    },
    async setActive(key, active, at) {
      updateConversation(key, { active, updatedAt: at });
    },
    async listConversationsOfChat(chatId) {
      return [...conversations.values()].filter((conversation) => conversation.currentChatId === chatId).map((conversation) => structuredClone(conversation));
    },
    async listConversationsOfUser(userId) {
      return [...conversations.values()].filter((conversation) => conversation.userId === userId).map((conversation) => structuredClone(conversation));
    },
    async addMemberHit(hit) {
      hits.set(hit.id, { messenger: hit.messenger, botId: hit.botId, externalChatId: hit.externalChatId, externalUserId: hit.externalUserId, at: hit.at });
    },
    async countMemberHits(key, externalUserId, since) {
      const id = conversationId(key);
      return [...hits.values()].filter((hit) => conversationId(hit) === id && hit.externalUserId === externalUserId && time(hit.at) >= time(since)).length;
    },
    async claimUpdate(key, now, work) {
      if (updates.has(key)) return false;
      if (!work) updates.set(key, { receivedAt: now, attempts: 0 });
      else {
        const { holder, leaseUntil, ...content } = work;
        updates.set(key, { receivedAt: now, work: structuredClone(content), holder, leaseUntil, attempts: 0 });
      }
      return true;
    },
    async finishUpdate(key) {
      // Повтор узнаётся по самому ключу; содержимое законченного не нужно.
      const entry = updates.get(key);
      if (entry) updates.set(key, { receivedAt: entry.receivedAt, attempts: entry.attempts });
    },
    async renewUpdates(keys, holder, leaseUntil) {
      for (const key of keys) {
        const entry = updates.get(key);
        if (entry?.work && entry.holder === holder) entry.leaseUntil = leaseUntil;
      }
    },
    async releaseUpdate(key, holder, retryAt) {
      const entry = updates.get(key);
      if (entry?.work && entry.holder === holder) Object.assign(entry, { holder: "", leaseUntil: retryAt });
    },
    async takeAbandonedUpdates(bot, holder, now, leaseUntil, limit) {
      const taken = [...updates.entries()]
        .filter(([, entry]) => entry.work?.messenger === bot.messenger && entry.work.botId === bot.botId && time(entry.leaseUntil ?? now) <= time(now))
        .sort(([, left], [, right]) => time(left.receivedAt) - time(right.receivedAt))
        .slice(0, limit);
      return taken.map(([key, entry]) => {
        Object.assign(entry, { holder, leaseUntil, attempts: entry.attempts + 1 });
        return { key, update: structuredClone(entry.work?.update), receivedAt: entry.receivedAt, attempts: entry.attempts };
      });
    },
    async saveButton(button) {
      buttons.set(button.id, { key: conversationId(button), action: structuredClone(button.action), createdAt: button.createdAt });
    },
    async takeButton(key, id, now) {
      const button = buttons.get(id);
      if (!button || button.usedAt || button.key !== conversationId(key)) return null;
      button.usedAt = now;
      return structuredClone(button.action);
    },
    async savePendingDelivery(delivery, holder, leaseUntil) {
      deliveries.set(delivery.id, { delivery: structuredClone(delivery), holder, leaseUntil });
    },
    async deletePendingDelivery(id) {
      deliveries.delete(id);
    },
    async renewPendingDeliveries(holder, leaseUntil) {
      for (const entry of deliveries.values()) if (entry.holder === holder) entry.leaseUntil = leaseUntil;
    },
    async takeAbandonedDeliveries(bot, holder, now, leaseUntil, limit) {
      const taken = [...deliveries.values()]
        .filter((entry) => entry.delivery.messenger === bot.messenger && entry.delivery.botId === bot.botId && time(entry.leaseUntil) <= time(now))
        .slice(0, limit);
      for (const entry of taken) Object.assign(entry, { holder, leaseUntil });
      return taken.map((entry) => structuredClone(entry.delivery));
    },
    async acquireLease(name, holder, leaseUntil, now) {
      const lease = leases.get(name);
      if (lease && lease.holder !== holder && time(lease.leaseUntil) > time(now)) return false;
      leases.set(name, { holder, leaseUntil });
      return true;
    },
    async releaseLease(name, holder) {
      if (leases.get(name)?.holder === holder) leases.delete(name);
    },
    async purgeBefore(before) {
      const cutoff = time(before);
      for (const [hash, code] of codes) if (time(code.expiresAt) < cutoff) codes.delete(hash);
      // Обновление с живой арендой не убирается: его ещё подберут или бросят. Аренда, истёкшая раньше срока хранения, —
      // забытое обновление (например, бот убран из настроек): его уже никто не подберёт.
      for (const [key, update] of updates) if (time(update.receivedAt) < cutoff && (!update.work || time(update.leaseUntil ?? before) < cutoff)) updates.delete(key);
      for (const [id, button] of buttons) if (time(button.createdAt) < cutoff) buttons.delete(id);
      for (const [id, hit] of hits) if (time(hit.at) < cutoff) hits.delete(id);
    },
  };
}

/** Без полей со значением `undefined`: так запись из памяти совпадает с записью из базы. */
function withoutEmpty<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}
