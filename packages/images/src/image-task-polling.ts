import type { ImageTaskState } from "./image-catalog";
import { ImageGenerationError } from "./image-generation-error";

/** Первая проверка задачи — через это время: быстрее картинка не бывает готова. */
const FIRST_CHECK_MS = 2_000;
/** Каждый следующий интервал во столько раз длиннее… */
const INTERVAL_GROWTH = 1.5;
/** …но не длиннее этого: готовую картинку не ждём лишнего. */
const MAX_INTERVAL_MS = 10_000;

export interface WaitForImageTaskInput {
  check(abortSignal: AbortSignal | undefined): Promise<ImageTaskState>;
  /** Срок по `Date.now()`: дальше опроса нет, итог — `timeout`. */
  deadline: number;
  /** «Стоп»: ожидание обрывается сразу, наружу — причина сигнала. */
  abortSignal?: AbortSignal;
  /** Первая проверка сразу, а не через интервал: задача отправлена давно (повтор, фоновый опрос после перерыва). */
  checkNow?: boolean;
}

export type WaitedImageTask = Exclude<ImageTaskState, { status: "pending" }> | { status: "timeout" };

/** Пауза до `ms`, которую «Стоп» обрывает. Таймер не держит процесс: ждать фоновую задачу при выходе незачем. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    (timer as { unref?: () => void }).unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Опрос задачи в очереди провайдера: 2 с, затем интервал растёт в полтора раза до 10 с. Последняя проверка — ровно в
 * срок. Временный сбой проверки (сеть, 5xx) не прерывает опрос; `ImageGenerationError` — прерывает.
 */
export async function waitForImageTask(input: WaitForImageTaskInput): Promise<WaitedImageTask> {
  let interval = FIRST_CHECK_MS;
  let first = true;
  for (;;) {
    if (!(first && input.checkNow)) {
      const left = input.deadline - Date.now();
      if (left <= 0) return { status: "timeout" };
      await pause(Math.min(interval, left), input.abortSignal);
      interval = Math.min(interval * INTERVAL_GROWTH, MAX_INTERVAL_MS);
    }
    first = false;
    try {
      const state = await input.check(input.abortSignal);
      if (state.status !== "pending") return state;
    } catch (error) {
      if (input.abortSignal?.aborted) throw input.abortSignal.reason ?? error;
      if (error instanceof ImageGenerationError) throw error;
    }
    if (Date.now() >= input.deadline) return { status: "timeout" };
  }
}
