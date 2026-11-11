import type { ChatStorage } from "../storage/chat-storage";

/**
 * «Стоп» по id запроса хода (`TurnRequestContext.turnRequestId`). Человек жмёт «Стоп» сразу после отправки: запрос
 * остановки может прийти раньше, чем служба начала ход, или на другую копию сервера. Остановка запоминается по id
 * запроса — в памяти копии и в хранилище, — и ход с этим id останавливается, как только начнётся или узнает о ней.
 * Следующий запрос несёт новый id: чужой «Стоп» его не остановит.
 */

/** Как часто идущий ход сверяется с хранилищем: не пришёл ли его «Стоп» на другую копию. */
export const STOP_REQUESTS_CHECK_EVERY_MS = 2_000;
/**
 * Сколько помнить «Стоп»: ход запроса начинается за секунды, идущий на другой копии узнаёт о нём за 2 с — час с
 * большим запасом.
 */
export const STOP_REQUEST_KEEP_MS = 60 * 60 * 1000;
/**
 * Сколько «Стопов» одного человека помнить (в памяти копии и в хранилище): сверх — уходят его же старые. Чужие записи
 * поток «Стопов» одного человека не вытесняет, таблица не растёт без предела.
 */
export const STOP_REQUESTS_PER_OWNER = 100;

export interface StopRequests {
  /** Ход запроса `turnRequestId` идёт на этой копии: останавливается, `true`. Иначе — `false`, ничего не меняется. */
  stopRunning(chatId: string, turnRequestId: string): boolean;
  /**
   * Запомнить «Стоп» запроса `turnRequestId`, чей ход ещё не начался или идёт на другой копии: в копии и в хранилище.
   * Ход остановится, когда начнётся или сверится с хранилищем.
   */
  remember(ownerId: string, chatId: string, turnRequestId: string): Promise<void>;
  /**
   * Ход запроса `turnRequestId` начался: `abort` — когда пришёл его «Стоп» (уже пришедший — сразу). Слежка идёт до
   * вызова возвращённой функции.
   */
  watch(chatId: string, turnRequestId: string, abort: () => void): () => void;
}

export function createStopRequests(input: { storage: ChatStorage; now: () => Date; logError: (message: string, error?: unknown) => void }): StopRequests {
  const { storage, now, logError } = input;
  /** Принятые копией «Стопы»: чьи и до какого времени (мс). Map хранит порядок вставки — старые первыми. */
  const remembered = new Map<string, { ownerId: string; until: number }>();
  /** Ключи «Стопов» каждого человека, старые первыми. */
  const byOwner = new Map<string, string[]>();
  /** Идущие ходы этой копии с id запроса: их остановка. */
  const watched = new Map<string, () => void>();
  const keyOf = (chatId: string, turnRequestId: string) => JSON.stringify([chatId, turnRequestId]);

  function forget(key: string): void {
    const entry = remembered.get(key);
    if (!entry) return;
    remembered.delete(key);
    const keys = byOwner.get(entry.ownerId)!;
    keys.splice(keys.indexOf(key), 1);
    if (keys.length === 0) byOwner.delete(entry.ownerId);
  }

  /** Срок у всех один, поэтому истёкшие — в начале: обход стоит до первой живой записи. */
  function forgetExpired(at: number): void {
    for (const [key, { until }] of remembered) {
      if (until > at) return;
      forget(key);
    }
  }

  return {
    stopRunning(chatId, turnRequestId) {
      const running = watched.get(keyOf(chatId, turnRequestId));
      running?.();
      return running !== undefined;
    },

    async remember(ownerId, chatId, turnRequestId) {
      const stoppedAt = now();
      const expiresAt = stoppedAt.getTime() + STOP_REQUEST_KEEP_MS;
      const key = keyOf(chatId, turnRequestId);
      forgetExpired(stoppedAt.getTime());
      forget(key);
      const keys = byOwner.get(ownerId) ?? [];
      while (keys.length >= STOP_REQUESTS_PER_OWNER) forget(keys[0]!);
      remembered.set(key, { ownerId, until: expiresAt });
      keys.push(key);
      byOwner.set(ownerId, keys);
      if (!storage.saveStopRequest) return;
      await storage
        .saveStopRequest(
          { ownerId, chatId, turnRequestId, stoppedAt: stoppedAt.toISOString(), expiresAt: new Date(expiresAt).toISOString() },
          { keepPerOwner: STOP_REQUESTS_PER_OWNER },
        )
        // Не записался — «Стоп» действует только на этой копии.
        .catch((error: unknown) => logError(`«Стоп» хода чата ${chatId} не записан в хранилище: ${error instanceof Error ? error.message : String(error)}`, error));
    },

    watch(chatId, turnRequestId, abort) {
      const key = keyOf(chatId, turnRequestId);
      let ended = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      let failed = false;
      const end = () => {
        if (ended) return;
        ended = true;
        clearInterval(timer);
        if (watched.get(key) === fire) watched.delete(key);
      };
      const fire = () => {
        if (ended) return;
        end();
        forget(key);
        abort();
      };
      if (remembered.has(key)) {
        fire();
        return end;
      }
      watched.set(key, fire);
      const hasStopRequest = storage.hasStopRequest?.bind(storage);
      if (!hasStopRequest) return end;
      let checking = false;
      const check = () => {
        if (ended || checking) return;
        checking = true;
        void hasStopRequest(chatId, turnRequestId)
          .then(
            (stopped) => {
              if (stopped) fire();
            },
            (error: unknown) => {
              // Сбой чтения — в журнал один раз за ход; следующие проверки идут дальше.
              if (failed) return;
              failed = true;
              logError(`Не удалось проверить «Стоп» хода чата ${chatId}: ${error instanceof Error ? error.message : String(error)}`, error);
            },
          )
          .finally(() => {
            checking = false;
          });
      };
      check();
      timer = setInterval(check, STOP_REQUESTS_CHECK_EVERY_MS);
      timer.unref?.();
      return end;
    },
  };
}
