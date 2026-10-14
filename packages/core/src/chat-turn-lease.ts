import { ANSWER_ALIVE_EVERY_MS, ANSWER_STALE_AFTER_MS } from "./agent-run/answer-liveness";
import { ChatBusyError } from "./running-answers/running-answer-registry";
import type { ChatStorage } from "./storage/chat-storage";

/**
 * Один ход за раз на чат и между копиями сервера: пока копия запускает или ведёт ход, она держит аренду хода чата в
 * хранилище (`claimChatTurn`). Чужая живая аренда — чат занят (`ChatBusyError`), как ответ на этой же копии.
 */

/** Срок аренды: копия упала — другие ждут столько же, сколько до прерывания её брошенного ответа. */
export const CHAT_TURN_LEASE_MS = ANSWER_STALE_AFTER_MS;
/** Как часто идущий ход продлевает аренду: так же, как ставит знак жизни ответа. */
export const CHAT_TURN_RENEW_EVERY_MS = ANSWER_ALIVE_EVERY_MS;

export interface ChatTurnLeases {
  /**
   * Чат занят этой копией (запуск, ход, передача хода): первый вход берёт аренду, следующие только считаются. Снятие
   * прежней аренды этого чата ещё в пути — сначала дожидается его: иначе запоздалое снятие сотрёт новую аренду.
   * С `optional` чужая аренда не ошибка: вход без аренды, ответ `false`.
   * @throws ChatBusyError аренду держит другая копия.
   */
  enter(chatId: string, entering?: { optional?: boolean }): Promise<boolean>;
  /** Конец занятости; последний выход снимает аренду. */
  leave(chatId: string): void;
  /** Остановка службы: снимает все аренды и ждёт, пока снятия дойдут до хранилища. */
  releaseAll(): Promise<void>;
  /**
   * Старт единственной копии: снимает аренды прошлых запусков (`clearChatTurnLeases`), свои — берёт снова. Хранилище
   * без этого метода — ничего: чужие аренды истекут сами.
   */
  clearForeign(): Promise<void>;
}

/** Хранилище без аренды — вход и выход ничего не делают: один ход за раз держится только внутри копии. */
export function createChatTurnLeases(input: { storage: ChatStorage; holder: string; logError: (message: string) => void }): ChatTurnLeases {
  const { storage, holder, logError } = input;
  if (!storage.claimChatTurn || !storage.releaseChatTurn) return { enter: async () => true, leave: () => {}, releaseAll: async () => {}, clearForeign: async () => {} };
  const claim = storage.claimChatTurn.bind(storage);
  const release = storage.releaseChatTurn.bind(storage);
  const held = new Map<string, { count: number; renew: ReturnType<typeof setInterval>; renewing?: Promise<unknown> }>();
  const claiming = new Map<string, Promise<void>>();
  // Снятия в пути по чатам: следующий вход того же чата и остановка службы ждут их.
  const releasing = new Map<string, Promise<void>>();

  const renewing = (chatId: string) =>
    setInterval(() => {
      const lease = held.get(chatId);
      if (!lease || lease.renewing) return;
      lease.renewing = claim(chatId, holder, CHAT_TURN_LEASE_MS)
        .then(
          (kept) => {
            if (!kept && held.has(chatId)) logError(`Аренда хода чата ${chatId} ушла к другой копии посреди хода: продление опоздало`);
          },
          (error: unknown) => logError(`Аренда хода чата ${chatId} не продлилась: ${error instanceof Error ? error.message : String(error)}`),
        )
        .finally(() => {
          lease.renewing = undefined;
        });
    }, CHAT_TURN_RENEW_EVERY_MS);

  function releasingLease(chatId: string, lease: { renew: ReturnType<typeof setInterval>; renewing?: Promise<unknown> }): void {
    clearInterval(lease.renew);
    held.delete(chatId);
    const previous = releasing.get(chatId);
    // Продление в пути дошло бы до базы после снятия и вернуло бы аренду: снятие идёт после него.
    const after = [previous, lease.renewing].filter((step) => step !== undefined);
    const done: Promise<void> = (after.length > 0 ? Promise.all(after).then(() => release(chatId, holder)) : release(chatId, holder))
      .catch((error: unknown) => {
        // Не снялась — истечёт сама через срок аренды.
        logError(`Аренда хода чата ${chatId} не снялась: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (releasing.get(chatId) === done) releasing.delete(chatId);
      });
    releasing.set(chatId, done);
  }

  return {
    async enter(chatId, entering = {}) {
      for (;;) {
        const lease = held.get(chatId);
        if (lease) {
          lease.count += 1;
          return true;
        }
        const pending = claiming.get(chatId) ?? releasing.get(chatId);
        if (!pending) break;
        // Аренду уже берёт или снимает этот же процесс: дождаться и решить заново.
        await pending.catch(() => {});
      }
      const taking = (async () => {
        if (!(await claim(chatId, holder, CHAT_TURN_LEASE_MS))) throw new ChatBusyError(chatId);
        held.set(chatId, { count: 1, renew: renewing(chatId) });
      })();
      claiming.set(chatId, taking);
      try {
        await taking;
        return true;
      } catch (error) {
        if (entering.optional && error instanceof ChatBusyError) return false;
        throw error;
      } finally {
        claiming.delete(chatId);
      }
    },

    leave(chatId) {
      const lease = held.get(chatId);
      if (!lease) return;
      lease.count -= 1;
      if (lease.count > 0) return;
      releasingLease(chatId, lease);
    },

    async releaseAll() {
      for (const [chatId, lease] of [...held]) releasingLease(chatId, lease);
      while (releasing.size > 0) await Promise.all([...releasing.values()]);
    },

    async clearForeign() {
      if (!storage.clearChatTurnLeases) return;
      await storage.clearChatTurnLeases();
      await Promise.all([...held.keys()].map((chatId) => claim(chatId, holder, CHAT_TURN_LEASE_MS)));
    },
  };
}
