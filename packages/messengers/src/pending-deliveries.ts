import { randomUUID } from "node:crypto";
import type { ButtonActions, CardButton } from "./button-actions";
import { htmlToPlainText } from "./markdown-to-messenger";
import { buttonsRejected, MessengerBlockedError, MessengerMarkupError } from "./messenger-api";
import type { MessengerAdapter, OutboundMessage, SentMessage } from "./messenger-adapter";
import { chatKeyOf, type DeliveryOutbox, type OutboundQueue } from "./outbound-queue";
import type { ConversationKey, MessengerBot, MessengerStore, PendingDelivery } from "./types";

/** Сколько итогов брать из хранилища за раз. */
const RECOVER_BATCH = 50;
/** Копия сервера держит свои итоги столько; продлевает раньше (см. `createMessengers`). */
export const DELIVERY_LEASE_MS = 2 * 60_000;
/** Итог, который мессенджер не принимает дольше суток, больше не повторяется. */
export const DELIVERY_GIVE_UP_MS = 24 * 60 * 60_000;
/** Пауза перед повтором отпущенного итога: столько, сколько он уже ждёт, но в этих пределах. */
const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;
/** Держатель отпущенного итога: его не продлевает никто, после паузы итог забирает любая копия. */
const RELEASED = "";

/** Итог для очереди: номер и время — одни на всё время итога, остальное читается при каждом вызове. */
export function durableDelivery(key: ConversationKey, read: () => Omit<PendingDelivery, keyof ConversationKey | "id" | "createdAt">): () => PendingDelivery {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  return () => ({ messenger: key.messenger, botId: key.botId, externalChatId: key.externalChatId, id, createdAt, ...read() });
}

/**
 * Итоги, пережившие перезапуск: очередь записывает итог в хранилище за этой копией сервера (аренда), копия продлевает
 * аренду, пока жива. Упала — после срока аренды итог забирает и отправляет другая копия или эта же после перезапуска.
 * Мессенджер недоступен дольше повторов очереди — итог отпускается и повторяется позже, пока ждёт не дольше суток.
 * Доставка «хотя бы раз»: падение между отправкой и удалением записи даст повтор.
 */
export function createPendingDeliveries(options: {
  store: MessengerStore;
  buttons: Pick<ButtonActions, "prepare">;
  holder?: string;
  leaseMs?: number;
  logError?(error: unknown): void;
}) {
  const { store, buttons } = options;
  const holder = options.holder ?? randomUUID();
  const leaseMs = options.leaseMs ?? DELIVERY_LEASE_MS;
  const logError = (error: unknown) => options.logError?.(error);
  const leaseUntil = () => new Date(Date.now() + leaseMs).toISOString();
  /**
   * Записи, которые не удалось удалить или отпустить: иначе продление держало бы их за этой копией вечно.
   * `null` — удалить, итог — отпустить.
   */
  const unsettled = new Map<string, PendingDelivery | null>();

  async function settle(id: string, change: () => Promise<void>, retry: PendingDelivery | null) {
    try {
      await change();
      unsettled.delete(id);
    } catch (error) {
      unsettled.set(id, retry);
      throw error;
    }
  }

  const outbox: DeliveryOutbox = {
    save: (delivery) => store.savePendingDelivery(delivery, holder, leaseUntil()),
    remove: (id) => settle(id, () => store.deletePendingDelivery(id), null),
    release: (delivery) =>
      settle(
        delivery.id,
        () => {
          const waited = Date.now() - Date.parse(delivery.createdAt);
          if (!(waited <= DELIVERY_GIVE_UP_MS)) return store.deletePendingDelivery(delivery.id);
          const pause = Math.min(Math.max(waited, RETRY_MIN_MS), RETRY_MAX_MS);
          return store.savePendingDelivery(delivery, RELEASED, new Date(Date.now() + pause).toISOString());
        },
        delivery,
      ),
  };

  /** Продлить аренду своих итогов; заодно повторить несостоявшиеся удаления и отпускания. */
  async function renew(): Promise<void> {
    for (const [id, delivery] of [...unsettled]) await (delivery ? outbox.release(delivery) : outbox.remove(id)).catch(logError);
    await store.renewPendingDeliveries(holder, leaseUntil());
  }

  /** Забрать брошенные итоги бота и поставить в его очередь. Возвращает, сколько забрано. */
  async function recover(bot: MessengerBot, queue: OutboundQueue): Promise<number> {
    let total = 0;
    for (;;) {
      const taken = await store.takeAbandonedDeliveries(bot, holder, new Date().toISOString(), leaseUntil(), RECOVER_BATCH);
      for (const delivery of taken) {
        queue.run(chatKeyOf(delivery), () => replay(bot.adapter, delivery), { durable: () => delivery }).catch((error: unknown) => {
          if (!(error instanceof MessengerBlockedError)) logError(error);
        });
      }
      total += taken.length;
      if (taken.length < RECOVER_BATCH) return total;
    }
  }

  /** Повтор итога: правка или новое сообщение; не приняли разметку — простым текстом, кнопки — без кнопок. */
  async function replay(adapter: MessengerAdapter, delivery: PendingDelivery): Promise<SentMessage> {
    const key: ConversationKey = { messenger: delivery.messenger, botId: delivery.botId, externalChatId: delivery.externalChatId };
    const prepared = delivery.rows?.length ? buttons.prepare(key, delivery.rows as CardButton[][]) : undefined;
    const deliver = async (message: OutboundMessage): Promise<SentMessage> => {
      if (!delivery.edit) return adapter.send(delivery.chat, message);
      await adapter.edit(delivery.edit, message);
      return delivery.edit;
    };
    let message: OutboundMessage = { text: delivery.message.text, markup: delivery.message.markup };
    const withMarkupFallback = async (extra: Pick<OutboundMessage, "buttons">) => {
      try {
        return await deliver({ ...message, ...extra });
      } catch (error) {
        if (!(error instanceof MessengerMarkupError) || message.markup !== "html") throw error;
        message = { text: htmlToPlainText(message.text), markup: "plain" };
        return deliver({ ...message, ...extra });
      }
    };
    const withButtons = prepared?.buttons ?? delivery.message.buttons;
    if (!withButtons) return withMarkupFallback({});
    let sent: SentMessage;
    try {
      sent = await withMarkupFallback({ buttons: withButtons });
    } catch (error) {
      if (!buttonsRejected(error)) throw error;
      return withMarkupFallback({});
    }
    if (prepared) await prepared.save(sent, message);
    return sent;
  }

  return { holder, outbox, renew, recover };
}

export type PendingDeliveries = ReturnType<typeof createPendingDeliveries>;
