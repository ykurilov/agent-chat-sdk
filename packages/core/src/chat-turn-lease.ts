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
  /** Сигнал утраты текущей аренды; у хранилища без аренды его нет. */
  signal(chatId: string): AbortSignal | undefined;
  /** Неповторяющийся токен текущего поколения, для атомарной ограды записей. */
  holder(chatId: string): string | undefined;
  /** Отказ атомарной записи подтвердил утрату именно этого поколения аренды. */
  invalidate(chatId: string, holder: string): void;
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
export function createChatTurnLeases(input: { storage: ChatStorage; holder: string; logError: (message: string) => void; onLost?: (chatId: string) => void }): ChatTurnLeases {
  const { storage, holder, logError } = input;
  if (!storage.claimChatTurn || !storage.releaseChatTurn) return { enter: async () => true, signal: () => undefined, holder: () => undefined, invalidate: () => {}, leave: () => {}, releaseAll: async () => {}, clearForeign: async () => {} };
  const claim = storage.claimChatTurn.bind(storage);
  const release = storage.releaseChatTurn.bind(storage);
  interface HeldLease {
    count: number;
    renew: ReturnType<typeof setInterval>;
    expiry?: ReturnType<typeof setTimeout>;
    renewing?: Promise<unknown>;
    controller: AbortController;
    lost: boolean;
    token: string;
    until: number;
  }
  const held = new Map<string, HeldLease>();
  let generation = 0;
  const claiming = new Map<string, Promise<void>>();
  // Снятия в пути по чатам: следующий вход того же чата и остановка службы ждут их.
  const releasing = new Map<string, Promise<void>>();

  function lose(chatId: string, lease: HeldLease, reason: string): void {
    if (held.get(chatId) !== lease || lease.lost) return;
    lease.lost = true;
    clearInterval(lease.renew);
    clearTimeout(lease.expiry);
    lease.controller.abort(new Error("Аренда хода утрачена"));
    logError(`Аренда хода чата ${chatId} утрачена: ${reason}; ход остановлен`);
    input.onLost?.(chatId);
  }

  function confirmedUntil(chatId: string, lease: HeldLease, claimStarted: number): void {
    if (held.get(chatId) !== lease || lease.lost) return;
    if (lease.until <= Date.now()) return lose(chatId, lease, "подтверждённый срок уже истёк");
    clearTimeout(lease.expiry);
    lease.until = claimStarted + CHAT_TURN_LEASE_MS;
    const left = lease.until - Date.now();
    if (left <= 0) return lose(chatId, lease, "истёк срок подтверждённой аренды");
    const checkExpiry = () => {
      if (held.get(chatId) !== lease || lease.lost) return;
      const remaining = lease.until - Date.now();
      if (remaining <= 0) return lose(chatId, lease, "продление не подтверждено до истечения срока");
      // Таймер может проснуться раньше wall-clock границы; подтверждённое владение ещё действует.
      lease.expiry = setTimeout(checkExpiry, remaining);
      lease.expiry.unref?.();
    };
    lease.expiry = setTimeout(checkExpiry, left);
    lease.expiry.unref?.();
  }

  const renewing = (chatId: string) =>
    setInterval(() => {
      const lease = held.get(chatId);
      if (!lease || lease.lost || lease.renewing) return;
      if (lease.until <= Date.now()) return lose(chatId, lease, "подтверждённый срок истёк до продления");
      const started = Date.now();
      lease.renewing = Promise.resolve().then(() => lease.lost || held.get(chatId) !== lease ? false : claim(chatId, lease.token, CHAT_TURN_LEASE_MS))
        .then(
          (kept) => {
            if (held.get(chatId) !== lease || lease.lost) return;
            if (!kept) lose(chatId, lease, "другой держатель");
            else confirmedUntil(chatId, lease, started);
          },
          () => lose(chatId, lease, "хранилище не подтвердило продление"),
        )
        .finally(() => { lease.renewing = undefined; });
    }, CHAT_TURN_RENEW_EVERY_MS);

  /** Зависший renewal ждётся не дольше подтверждённой аренды; поздний результат чистится только своим токеном. */
  function renewalBarrier(chatId: string, lease: HeldLease): Promise<void> | undefined {
    const pending = lease.renewing;
    if (!pending) return undefined;
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (expired: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (expired) {
          void pending.then(() => release(chatId, lease.token), () => release(chatId, lease.token)).catch((error: unknown) => {
            logError(`Позднее снятие аренды чата ${chatId} не удалось: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        resolve();
      };
      pending.then(() => finish(false), () => finish(false));
      const remaining = lease.until - Date.now();
      if (lease.lost || remaining <= 0) finish(true);
      else {
        timer = setTimeout(() => finish(true), remaining);
        timer.unref?.();
      }
    });
  }

  function releasingLease(chatId: string, lease: HeldLease): void {
    clearInterval(lease.renew);
    clearTimeout(lease.expiry);
    held.delete(chatId);
    const previous = releasing.get(chatId);
    // До expiry сохраняем порядок renewal → release. После него admission/shutdown не ждут зависший запрос.
    const after = [previous, renewalBarrier(chatId, lease)].filter((step) => step !== undefined);
    const done: Promise<void> = (after.length > 0 ? Promise.all(after).then(() => release(chatId, lease.token)) : release(chatId, lease.token))
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
          if (lease.lost) throw new ChatBusyError(chatId);
          lease.count += 1;
          return true;
        }
        const pending = claiming.get(chatId) ?? releasing.get(chatId);
        if (!pending) break;
        // Аренду уже берёт или снимает этот же процесс: дождаться и решить заново.
        await pending.catch(() => {});
      }
      const taking = (async () => {
        const started = Date.now();
        const token = `${holder}:${++generation}`;
        if (!(await claim(chatId, token, CHAT_TURN_LEASE_MS))) throw new ChatBusyError(chatId);
        if (started + CHAT_TURN_LEASE_MS <= Date.now()) {
          await release(chatId, token);
          throw new ChatBusyError(chatId);
        }
        const lease: HeldLease = { count: 1, renew: renewing(chatId), controller: new AbortController(), lost: false, token, until: started + CHAT_TURN_LEASE_MS };
        held.set(chatId, lease);
        confirmedUntil(chatId, lease, started);
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

    signal(chatId) { return held.get(chatId)?.controller.signal; },
    holder(chatId) { return held.get(chatId)?.token; },
    invalidate(chatId, token) {
      const lease = held.get(chatId);
      if (lease?.token === token) lose(chatId, lease, "запись отклонена атомарной оградой хранилища");
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
      await Promise.all([...held].filter(([, lease]) => !lease.lost).map(async ([chatId, lease]) => {
        const started = Date.now();
        try {
          if (!(await claim(chatId, lease.token, CHAT_TURN_LEASE_MS))) return lose(chatId, lease, "не удалось вернуть собственную аренду после startup recovery");
          confirmedUntil(chatId, lease, started);
        } catch (error) { lose(chatId, lease, "не подтверждено владение после startup recovery"); throw error; }
      }));
    },
  };
}
