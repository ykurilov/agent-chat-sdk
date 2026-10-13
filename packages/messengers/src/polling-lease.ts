import { randomUUID } from "node:crypto";
import type { InboundUpdate } from "./messenger-adapter";
import type { MessengerBot, MessengerStore } from "./types";

/** Аренда опроса по умолчанию. */
export const POLL_LEASE_MS = 30_000;
/** Продление аренды по умолчанию. */
export const POLL_RENEW_MS = 10_000;
/** Пауза перед новым опросом после сбоя сети. */
const POLL_RETRY_MS = 1000;
/** Пауза перед новой попыткой принять то же обновление растёт вдвое до этого предела. */
const ACCEPT_RETRY_MAX_MS = 30_000;

export interface PollingOptions {
  store: MessengerStore;
  bot: MessengerBot;
  /** Приём обновления: быстрый (запись и очередь), иначе опрос стоит. Бросил — то же обновление снова после паузы от секунды до 30 секунд. */
  onUpdate(update: InboundUpdate): Promise<void> | void;
  /** Кто держит аренду; по умолчанию случайный id копии сервера. */
  holder?: string;
  leaseMs?: number;
  renewMs?: number;
  logError?(error: unknown): void;
}

/**
 * Один опрашивающий на бота среди копий сервера (иначе Telegram отвечает «конфликт»). Аренда в базе продлевается
 * раз в `renewMs`; не продлилась — копия бросает опрос заранее, за `renewMs` до конца аренды, и другая копия
 * перехватывает его после истечения аренды.
 */
export function startPolling(options: PollingOptions): { stop(): Promise<void> } {
  const { store, bot } = options;
  const holder = options.holder ?? randomUUID();
  const leaseMs = options.leaseMs ?? POLL_LEASE_MS;
  const renewMs = options.renewMs ?? POLL_RENEW_MS;
  const leaseName = `poll:${bot.messenger}:${bot.botId}`;
  const logError = (error: unknown) => options.logError?.(error);

  let stopped = false;
  const stopListeners = new Set<() => void>();
  let currentPoll: AbortController | undefined;

  /** Ждёт `promise`, но не дольше остановки: зависшая база не держит `stop`. */
  function untilStopped<T>(promise: Promise<T>): Promise<T | undefined> {
    if (stopped) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const onStop = () => resolve(undefined);
      stopListeners.add(onStop);
      promise.then(resolve, reject).finally(() => stopListeners.delete(onStop));
    });
  }

  const pause = (ms: number) => untilStopped(new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /** `held` — аренда наша до `until`; `taken` — у другой копии; `error` — база не ответила. */
  async function claim(): Promise<{ result: "held"; until: number } | { result: "taken" | "error" }> {
    const now = Date.now();
    try {
      const ok = await store.acquireLease(leaseName, holder, new Date(now + leaseMs).toISOString(), new Date(now).toISOString());
      return ok ? { result: "held", until: now + leaseMs } : { result: "taken" };
    } catch (error) {
      logError(error);
      return { result: "error" };
    }
  }

  async function holdAndPoll(firstUntil: number) {
    const controller = new AbortController();
    currentPoll = controller;
    let leaseUntil = firstUntil;
    let renewal: Promise<void> | undefined;
    const renewTimer = setInterval(() => {
      // Последнее подтверждённое продление слишком старое — бросаем опрос, пока аренда ещё наша.
      if (leaseUntil - Date.now() <= renewMs) {
        controller.abort();
        return;
      }
      if (renewal) return;
      renewal = claim().then((claimed) => {
        renewal = undefined;
        if (claimed.result === "held") leaseUntil = claimed.until;
        else if (claimed.result === "taken") controller.abort();
      });
    }, renewMs);

    try {
      while (!controller.signal.aborted) {
        try {
          for await (const update of bot.adapter.poll(controller.signal)) {
            // Обновление не принято (база недоступна) — то же снова после паузы: следующий опрос подтвердит его мессенджеру.
            // Пауза растёт; пропустить безнадёжное решает приём.
            for (let retryMs = POLL_RETRY_MS; ; retryMs = Math.min(retryMs * 2, ACCEPT_RETRY_MAX_MS)) {
              try {
                await options.onUpdate(update);
                break;
              } catch (error) {
                logError(error);
              }
              if (controller.signal.aborted) break;
              await pause(retryMs);
              if (controller.signal.aborted || stopped) break;
            }
            if (controller.signal.aborted) break;
          }
        } catch (error) {
          if (controller.signal.aborted) break;
          logError(error);
        }
        if (!controller.signal.aborted) await untilStopped(new Promise<void>((resolve) => setTimeout(resolve, POLL_RETRY_MS)));
      }
    } finally {
      clearInterval(renewTimer);
      currentPoll = undefined;
    }
    if (stopped) {
      // Продление в пути после отпускания вернуло бы аренду: ждём его, потом отпускаем.
      if (renewal) await untilStopped(renewal);
      await store.releaseLease(leaseName, holder).catch(logError);
    }
  }

  const running = (async () => {
    while (!stopped) {
      const claimed = await untilStopped(claim());
      if (claimed?.result === "held" && !stopped) await holdAndPoll(claimed.until);
      else if (claimed?.result === "held") await store.releaseLease(leaseName, holder).catch(logError);
      if (!stopped) await pause(renewMs);
    }
  })();

  return {
    async stop() {
      stopped = true;
      currentPoll?.abort();
      for (const listener of [...stopListeners]) listener();
      await running;
    },
  };
}
