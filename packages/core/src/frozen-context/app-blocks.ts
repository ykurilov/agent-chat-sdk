import type { ContextBlockEntry, ContextBlocksInput, ContextBlocksSource } from "./context-blocks";

/** Срок ответа `contextBlocks` по умолчанию: блоки нужны до первого запроса модели, долгая функция держит весь ход. */
export const DEFAULT_CONTEXT_BLOCKS_TIMEOUT_MS = 5_000;

/**
 * Источник блоков приложения для `freezeContext`: зовёт функцию приложения со сроком. Не ответила за срок — бросает
 * ошибку (блоки возьмутся из базы, строка в журнал), функция получает отмену через `abortSignal`. «Стоп» — тоже
 * бросает, а `freezeContext` по сигналу промолчит. Функция может не слушать отмену: ход ждёт её не дольше срока.
 */
export function appBlocksSource(options: {
  contextBlocks: ContextBlocksSource;
  /** Срок, мс; `Infinity` — без срока. */
  timeoutMs: number;
  input: Omit<ContextBlocksInput, "abortSignal">;
  /** «Стоп» и срок хода. */
  signal: AbortSignal;
}): () => Promise<ContextBlockEntry[] | null | undefined> {
  const { contextBlocks, timeoutMs, input, signal } = options;
  return async () => {
    const ownAbort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onStop: (() => void) | undefined;
    const cutOff = new Promise<"timeout" | "stopped">((resolve) => {
      if (Number.isFinite(timeoutMs)) timer = setTimeout(() => resolve("timeout"), timeoutMs);
      onStop = () => resolve("stopped");
      if (signal.aborted) onStop();
      else signal.addEventListener("abort", onStop, { once: true });
    });
    try {
      const call = Promise.resolve().then(() => contextBlocks({ ...input, abortSignal: AbortSignal.any([signal, ownAbort.signal]) }));
      // Брошенный после срока вызов не должен стать необработанным отказом.
      call.catch(() => {});
      const outcome = await Promise.race([call.then((blocks) => ({ blocks })), cutOff]);
      if (outcome === "stopped") throw new Error("ход остановлен");
      if (outcome === "timeout") {
        const reason = new Error(`не ответил за ${timeoutMs} мс`);
        ownAbort.abort(reason);
        throw reason;
      }
      return outcome.blocks;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onStop!);
    }
  };
}
