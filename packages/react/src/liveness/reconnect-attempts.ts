export const DEFAULT_RECONNECT_DELAYS_MS: readonly number[] = [0, 2000, 5000];

export type ReconnectOutcome = "connected" | "exhausted" | "cancelled";

export interface ReconnectAttemptsOptions {
  /** Пауза перед каждой попыткой; сколько пауз — столько попыток. */
  delaysMs: readonly number[];
  /** Срок попытки целиком: история, заголовки потока и первый байт. */
  attemptTimeoutMs: number;
  /** Одна попытка: `true` — подключились. Её сигнал отменяется по сроку и при отмене серии. */
  attempt: (signal: AbortSignal, index: number) => Promise<boolean>;
  /** Отмена всей серии («стоп», уход со страницы). */
  signal: AbortSignal;
}

/** Серия попыток переподключения с паузами и общим сроком на каждую попытку (research R10). */
export async function runReconnectAttempts(options: ReconnectAttemptsOptions): Promise<ReconnectOutcome> {
  const { delaysMs, attemptTimeoutMs, attempt, signal } = options;
  for (let index = 0; index < delaysMs.length; index++) {
    if (!(await sleep(delaysMs[index] ?? 0, signal))) return "cancelled";
    const outcome = await runOne(index);
    if (outcome === "cancelled") return "cancelled";
    if (outcome === "connected") return "connected";
  }
  return "exhausted";

  async function runOne(index: number): Promise<"connected" | "failed" | "cancelled"> {
    const attemptController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onSeriesAbort: () => void = () => {};
    const interrupted = new Promise<"failed" | "cancelled">((resolve) => {
      timer = setTimeout(() => {
        attemptController.abort();
        resolve("failed");
      }, attemptTimeoutMs);
      onSeriesAbort = () => {
        attemptController.abort();
        resolve("cancelled");
      };
      signal.addEventListener("abort", onSeriesAbort);
    });
    try {
      const succeeded = attempt(attemptController.signal, index).then(
        (ok) => (ok ? ("connected" as const) : ("failed" as const)),
        () => "failed" as const,
      );
      const outcome = await Promise.race([succeeded, interrupted]);
      return signal.aborted ? "cancelled" : outcome;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onSeriesAbort);
    }
  }
}

/** Ждёт `ms`; `false` — отменили. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
