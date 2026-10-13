import { ConnectionLostError } from "./connection-errors";
import { watchSilence } from "./silence-watchdog";
import type { SilenceWatchOptions } from "./silence-watchdog";

export interface DeadlineOptions {
  /** Срок до заголовков ответа. */
  timeoutMs: number;
  /** Своя отмена (серия попыток): для SDK это обрыв связи, а не стоп собеседника. */
  signal?: AbortSignal;
  /** Срок покрывает и тело ответа: для запросов без потока. */
  wholeBody?: boolean;
  /** Следить за тишиной в теле потока; параметры строятся по ответу (например, по заголовку сервера). */
  silence?: (response: Response) => Omit<SilenceWatchOptions, "translateError" | "onEnd">;
}

/**
 * `fetch` со сроком. Сетевой `TypeError` и истёкший срок становятся `ConnectionLostError`.
 * Отмена собеседником (`init.signal`) остаётся `AbortError`.
 */
export async function fetchWithDeadline(
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>,
  input: string,
  init: RequestInit | undefined,
  options: DeadlineOptions,
): Promise<Response> {
  const userSignal = init?.signal ?? undefined;
  const own = new AbortController();
  const abortOwn = (reason?: unknown) => {
    if (!own.signal.aborted) own.abort(reason);
  };
  const forwardUserAbort = () => abortOwn(userSignal?.reason);
  const forwardAttemptAbort = () => abortOwn(new ConnectionLostError());
  if (userSignal?.aborted) forwardUserAbort();
  userSignal?.addEventListener("abort", forwardUserAbort);
  if (options.signal?.aborted) forwardAttemptAbort();
  options.signal?.addEventListener("abort", forwardAttemptAbort);

  let failDeadline: (error: ConnectionLostError) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    failDeadline = reject;
  });
  deadline.catch(() => {});
  const timer = setTimeout(() => {
    const lost = new ConnectionLostError(`Server did not respond within ${options.timeoutMs} ms`);
    failDeadline(lost);
    abortOwn(lost);
  }, options.timeoutMs);
  const cleanup = () => {
    clearTimeout(timer);
    userSignal?.removeEventListener("abort", forwardUserAbort);
    options.signal?.removeEventListener("abort", forwardAttemptAbort);
  };
  /** Сетевой обрыв и своя отмена — потеря связи; отмена собеседником — как есть. */
  const translate = (error: unknown): unknown => {
    if (userSignal?.aborted) return error;
    if (error instanceof ConnectionLostError) return error;
    if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) {
      return new ConnectionLostError(error.message, { cause: error });
    }
    return error;
  };

  try {
    const response = await Promise.race([fetchFn(input, { ...init, signal: own.signal }), deadline]);
    // Тело отказа короткое и обычно никем не дочитывается: читаем его сразу, чтобы слушатели снялись.
    if (options.wholeBody || !response.ok) {
      const buffered = await Promise.race([response.arrayBuffer(), deadline]);
      cleanup();
      return new Response(buffered, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    clearTimeout(timer);
    if (!response.body) {
      cleanup();
      return response;
    }
    // Одна обёртка тела: тишина, перевод ошибок чтения и снятие слушателей по концу тела.
    const body = watchSilence(response.body, {
      silenceTimeoutMs: Infinity,
      ...options.silence?.(response),
      translateError: translate,
      onEnd: cleanup,
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    cleanup();
    throw translate(error);
  }
}
