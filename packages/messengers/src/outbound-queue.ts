import { MessengerApiError, MessengerBlockedError, MessengerRateLimitError } from "./messenger-api";
import type { ConversationKey, PendingDelivery } from "./types";

/** Ключ чата в очереди: у всех, кто пишет в один внешний чат, общая частота. */
export const chatKeyOf = (key: ConversationKey) => `${key.messenger}/${key.botId}/${key.externalChatId}`;

export interface OutboundQueueOptions {
  /** Пауза между правками в одном чате. По умолчанию 1000 мс. */
  gapMs?: number;
  /** «Слишком часто» дольше этого — промежуточные правки пропускаются. По умолчанию 5000 мс. */
  maxWaitMs?: number;
  /** Сколько раз пробовать итог при сбое сети или 5xx. По умолчанию 4. */
  finalAttempts?: number;
  /** Первая пауза перед повтором итога, дальше вдвое длиннее. По умолчанию 1000 мс. */
  retryDelayMs?: number;
  /** Человек заблокировал бота: разговор помечается, ход не повторяется. */
  onBlocked?(chatKey: string): void;
  /** Куда записывать итоги, чтобы они пережили перезапуск. Нет — очередь только в памяти. */
  outbox?: DeliveryOutbox;
  logError?(error: unknown): void;
}

/** Записи итогов в хранилище: запись — до отправки, удаление — когда итог ушёл или окончательно не ушёл. */
export interface DeliveryOutbox {
  save(delivery: PendingDelivery): Promise<void>;
  remove(id: string): Promise<void>;
  /** Временный сбой пережил все повторы: запись остаётся, итог позже повторит аренда (`recover`). */
  release(delivery: PendingDelivery): Promise<void>;
}

/**
 * `slot` — промежуточная правка (печать по ходу): идёт не чаще `gapMs`, новая с тем же `slot` заменяет ждущую,
 * при долгом «слишком часто» или сбое пропускается. Без `slot` — итог: всегда уходит, по порядку, с повторами;
 * `paced` — итог тоже соблюдает паузу (последняя правка печатаемого сообщения).
 */
export interface RunOptions {
  slot?: string;
  paced?: boolean;
  /**
   * Итог в виде, который можно сохранить и повторить после перезапуска. Читается при постановке в очередь и ещё раз
   * перед отправкой: к тому времени могло стать известно сообщение для правки.
   */
  durable?: () => PendingDelivery;
}

interface QueueItem {
  op: () => Promise<unknown>;
  slot?: string;
  paced: boolean;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

interface ChatLane {
  items: QueueItem[];
  /** Разбор очереди идёт; флаг ставится до первого `await`, поэтому не промахивается. */
  active: boolean;
  running: Promise<void>;
  /** Когда закончилось последнее обращение к мессенджеру. */
  lastAt: number;
  /** До этого момента мессенджер просил не писать. */
  quietUntil: number;
  /** Прервать паузу перед ждущей правкой (после `drop`). */
  wake?: () => void;
}

const IDLE_LANE_MS = 60_000;
const IDLE_LANE_CHECK_SIZE = 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Пауза, которую можно прервать: `wake` будит раньше срока. */
function wakeableSleep(lane: ChatLane, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      lane.wake = undefined;
      resolve();
    }
    lane.wake = done;
  });
}

/** Очередь отправки в мессенджер по чатам: частота, «слишком часто», повторы итога, «заблокирован». */
export function createOutboundQueue(options: OutboundQueueOptions = {}) {
  const gapMs = options.gapMs ?? 1000;
  const maxWaitMs = options.maxWaitMs ?? 5000;
  const finalAttempts = options.finalAttempts ?? 4;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const lanes = new Map<string, ChatLane>();
  const logError = (error: unknown) => options.logError?.(error);
  /** Удаления и отпускания записей, которые ещё идут: `flush` ждёт и их. */
  const settling = new Set<Promise<void>>();

  /** Чаты, где давно тихо, забываются: память не растёт с числом собеседников. */
  function forgetIdleLanes() {
    const now = Date.now();
    for (const [key, lane] of lanes) if (!lane.active && lane.lastAt + IDLE_LANE_MS < now && lane.quietUntil < now) lanes.delete(key);
  }

  function run<T>(chatKey: string, op: () => Promise<T>, runOptions: RunOptions = {}): Promise<T | undefined> {
    if (lanes.size > IDLE_LANE_CHECK_SIZE) forgetIdleLanes();
    let lane = lanes.get(chatKey);
    if (!lane) {
      lane = { items: [], active: false, running: Promise.resolve(), lastAt: Number.NEGATIVE_INFINITY, quietUntil: 0 };
      lanes.set(chatKey, lane);
    }
    const { slot } = runOptions;
    const outbox = slot === undefined && runOptions.durable ? options.outbox : undefined;
    const delivery = outbox && runOptions.durable?.();
    if (outbox && delivery && runOptions.durable) op = recorded(outbox, op, delivery, runOptions.durable);
    const result = new Promise<T | undefined>((resolve, reject) => {
      const waiting = slot === undefined ? undefined : lane.items.find((item) => item.slot === slot);
      if (waiting) {
        // Ждущая правка устарела: её место занимает новая, старая считается пропущенной.
        waiting.resolve(undefined);
        waiting.op = op;
        waiting.resolve = resolve as (value: unknown) => void;
        waiting.reject = reject;
        return;
      }
      lane.items.push({ op, ...(slot !== undefined && { slot }), paced: slot !== undefined || runOptions.paced === true, resolve: resolve as (value: unknown) => void, reject });
    });
    // Итог ушёл или не уйдёт никогда — запись не нужна. Мессенджер временно недоступен — запись ждёт повтора.
    if (outbox && delivery && runOptions.durable) {
      const durable = runOptions.durable;
      void result.then(
        () => settle(outbox.remove(delivery.id)),
        (error: unknown) => settle(isTemporary(error) ? outbox.release(durable()) : outbox.remove(delivery.id)),
      );
    }
    if (!lane.active) {
      lane.active = true;
      lane.running = drain(chatKey, lane);
    }
    return result;
  }

  /** Итог записывается сразу и ещё раз перед отправкой, если поменялся. */
  function recorded<T>(outbox: DeliveryOutbox, op: () => Promise<T>, delivery: PendingDelivery, durable: () => PendingDelivery): () => Promise<T> {
    let snapshot = JSON.stringify(delivery);
    let saving = outbox.save(delivery).catch(logError);
    return async () => {
      await saving;
      const current = durable();
      if (JSON.stringify(current) !== snapshot) {
        snapshot = JSON.stringify(current);
        saving = outbox.save(current).catch(logError);
        await saving;
      }
      return op();
    };
  }

  function settle(change: Promise<void>) {
    const work = change.catch(logError);
    settling.add(work);
    void work.finally(() => settling.delete(work));
  }

  async function drain(chatKey: string, lane: ChatLane) {
    while (lane.items.length > 0) {
      const head = lane.items[0] as QueueItem;
      const droppable = head.slot !== undefined;
      if (droppable && Date.now() < lane.quietUntil) {
        lane.items.shift();
        head.resolve(undefined);
        continue;
      }
      const startAt = Math.max(head.paced ? lane.lastAt + gapMs : 0, droppable ? 0 : lane.quietUntil);
      if (startAt > Date.now()) {
        // Пока ждали, правку могли заменить (тот же объект, новое действие) или снять: смотрим очередь заново.
        await wakeableSleep(lane, startAt - Date.now());
        continue;
      }
      // Без паузы — сразу снимаем с очереди: иначе следующая правка заменила бы уже уходящую.
      lane.items.shift();
      await perform(chatKey, lane, head);
    }
    lane.active = false;
  }

  async function perform(chatKey: string, lane: ChatLane, item: QueueItem) {
    const droppable = item.slot !== undefined;
    let failures = 0;
    for (;;) {
      try {
        const value = await item.op();
        lane.lastAt = Date.now();
        item.resolve(value);
        return;
      } catch (error) {
        lane.lastAt = Date.now();
        if (error instanceof MessengerBlockedError) {
          options.onBlocked?.(chatKey);
          if (droppable) item.resolve(undefined);
          else item.reject(error);
          for (const rest of lane.items.splice(0)) {
            if (rest.slot !== undefined) rest.resolve(undefined);
            else rest.reject(error);
          }
          return;
        }
        if (error instanceof MessengerRateLimitError) {
          lane.quietUntil = Date.now() + error.retryAfterMs;
          if (droppable && error.retryAfterMs > maxWaitMs) {
            item.resolve(undefined);
            return;
          }
          failures++;
          if (failures >= finalAttempts + 1) {
            item.reject(error);
            return;
          }
          await sleep(error.retryAfterMs);
          continue;
        }
        if (droppable) {
          options.logError?.(error);
          item.resolve(undefined);
          return;
        }
        failures++;
        if (!isTransient(error) || failures >= finalAttempts) {
          item.reject(error);
          return;
        }
        await sleep(retryDelayMs * 2 ** (failures - 1));
      }
    }
  }

  /** Снять ждущие правки, чей `slot` начинается с `slotPrefix`: ответ закончился, итог не должен ждать их паузы. */
  function drop(chatKey: string, slotPrefix: string) {
    const lane = lanes.get(chatKey);
    if (!lane) return;
    const kept: QueueItem[] = [];
    for (const item of lane.items) {
      if (item.slot?.startsWith(slotPrefix)) item.resolve(undefined);
      else kept.push(item);
    }
    lane.items = kept;
    lane.wake?.();
  }

  /** Ждёт, пока все чаты опустеют. */
  async function flush() {
    for (;;) {
      const busy = [...lanes.values()].filter((lane) => lane.active);
      if (busy.length === 0 && settling.size === 0) return;
      await Promise.all([...busy.map((lane) => lane.running), ...settling]);
    }
  }

  return { run, drop, flush };
}

export type OutboundQueue = ReturnType<typeof createOutboundQueue>;

/** Сбой, который пройдёт сам: сеть, сервер мессенджера, «слишком часто». */
export function isTemporary(error: unknown): boolean {
  return error instanceof MessengerRateLimitError || isTransient(error);
}

/** Сбой сети или сервера мессенджера: итог стоит повторить. Ошибки запроса (4xx) повтор не исправит. */
function isTransient(error: unknown): boolean {
  if (error instanceof MessengerApiError) return error.status >= 500 || error.status === 0;
  return error instanceof TypeError || (error instanceof Error && /network|fetch|ECONN|ETIMEDOUT|socket/i.test(error.message));
}
