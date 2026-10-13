import type { ChatEvents } from "../chat-events/chat-events";
import { publicAppState } from "./app-state";
import type { AppStateValues } from "./app-state";

/**
 * Почему сменилось состояние: ход в конце ветки (`turn`), смена ветки или запись проверки ответа виджета
 * (`widgetAnswer`: `ctx.state` в `checkAnswer`, сразу после записи ответа, до продолжения хода).
 */
export type StateChangeReason = "turn" | "editMessage" | "regenerate" | "retry" | "selectBranch" | "editAnswer" | "widgetAnswer";

/** Что получает `onStateChanged`: состояние без служебных ключей SDK. */
export interface StateChangedInput {
  ownerId: string;
  chatId: string;
  reason: StateChangeReason;
  /** Состояние после смены. */
  state: AppStateValues;
  /** Состояние до смены. */
  previousState: AppStateValues;
  /** Последнее сообщение ветки после смены; пустой чат — `null`. */
  atMessageId: string | null;
}

/**
 * Хук смены состояния чата: копия состояния в таблицах приложения. Повтор с тем же состоянием ничего не должен ломать —
 * сводите копию полной заменой. Бросок или отказ — повтор.
 */
export type StateChangedHandler = (input: StateChangedInput) => void | Promise<void>;

/** Срок хука смены состояния по умолчанию: все попытки и паузы, мс. */
export const DEFAULT_STATE_CHANGED_TIMEOUT_MS = 30_000;
/** Попыток хука смены состояния по умолчанию. */
export const DEFAULT_STATE_CHANGED_ATTEMPTS = 3;
const RETRY_PAUSES_MS = [1000, 3000];

export interface StateChanged {
  /**
   * Состояние сменилось (сравниваются публичные состояния): событие `state-changed` и хук приложения с повторами в
   * своём сроке. Хуки одного чата — по очереди: следующий начинается после конца предыдущего (с его повторами), чтобы
   * старое состояние не легло поверх нового. Не изменилось — ничего. Не ждёт хук и не бросает.
   */
  notify(change: { ownerId: string; chatId: string; reason: StateChangeReason; before: AppStateValues; after: AppStateValues; atMessageId: string | null }): void;
  /** Дождаться всех хуков, в том числе вставших в очередь во время ожидания. После — хуки идут как обычно. */
  drain(): Promise<void>;
}

/** Проверяет пределы; неверные — `TypeError` при создании службы. */
export function createStateChanged(context: {
  handler?: StateChangedHandler;
  timeoutMs?: number;
  attempts?: number;
  chatEvents: ChatEvents;
  logError: (message: string) => void;
}): StateChanged {
  const timeoutMs = context.timeoutMs ?? DEFAULT_STATE_CHANGED_TIMEOUT_MS;
  const attempts = context.attempts ?? DEFAULT_STATE_CHANGED_ATTEMPTS;
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new TypeError("onStateChangedTimeoutMs — число миллисекунд больше нуля");
  if (!(Number.isInteger(attempts) && attempts >= 1)) throw new TypeError("onStateChangedAttempts — целое число от 1");
  const running = new Set<Promise<void>>();
  /** Последний хук в очереди каждого чата. */
  const queues = new Map<string, Promise<void>>();

  async function callHandler(handler: StateChangedHandler, input: StateChangedInput): Promise<void> {
    const failure = await callWithRetries(handler, input, timeoutMs, attempts);
    if (failure === undefined) return;
    context.logError(`onStateChanged не отработал (чат ${input.chatId}, причина ${input.reason}): ${failure}`);
    context.chatEvents.emit({ type: "state-changed-failed", ownerId: input.ownerId, chatId: input.chatId });
  }

  return {
    notify({ ownerId, chatId, reason, before, after, atMessageId }) {
      const state = publicAppState(after);
      const previousState = publicAppState(before);
      if (JSON.stringify(state) === JSON.stringify(previousState)) return;
      context.chatEvents.emit({ type: "state-changed", ownerId, chatId, reason, state, atMessageId });
      if (!context.handler) return;
      const handler = context.handler;
      const input: StateChangedInput = { ownerId, chatId, reason, state, previousState, atMessageId };
      const work = (queues.get(chatId) ?? Promise.resolve()).then(() => callHandler(handler, input));
      queues.set(chatId, work);
      running.add(work);
      void work.finally(() => {
        running.delete(work);
        if (queues.get(chatId) === work) queues.delete(chatId);
      });
    },
    async drain() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

/** Попытки в пределах срока; удалось — `undefined`, иначе — причина. */
async function callWithRetries(handler: StateChangedHandler, input: StateChangedInput, timeoutMs: number, attempts: number): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const deadline = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`срок ${timeoutMs} мс вышел`), timeoutMs);
  });
  const tries = (async (): Promise<string | undefined> => {
    let reason = "";
    for (let attempt = 1; attempt <= attempts && !expired; attempt++) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSES_MS[Math.min(attempt - 2, RETRY_PAUSES_MS.length - 1)]));
      if (expired) break;
      try {
        await handler(structuredClone(input));
        return undefined;
      } catch (failure) {
        reason = `попытка ${attempt} из ${attempts}: ${failure instanceof Error ? failure.message : String(failure)}`;
      }
    }
    return reason;
  })();
  try {
    return await Promise.race([tries, deadline]);
  } finally {
    expired = true;
    clearTimeout(timer);
  }
}
