import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import { APICallError } from "ai";
import { errorHeaders, errorName, errorStatusCode, errorText, requestedRetryMs } from "./error-fields";
import { isContextOverflow, isNotRetryable, looksTransient } from "./error-signs";
import { DEFAULT_MODEL_SILENCE } from "./model-silence";
import type { ModelSilenceLimits } from "./model-silence";

/** Паузы между тихими повторами: вместе около 10 с (FR-016a). */
const RETRY_DELAYS_MS = [1_000, 3_000, 6_000];
const RETRY_BUDGET_MS = RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
/** Случайная добавка к паузе — до 25%: много чатов после общего сбоя не повторяют разом (FR-019). */
const RETRY_JITTER = 0.25;
/**
 * Молчание до первого куска повторяется у того же провайдера один раз (FR-046): лёгший провайдер держит ход ~3 мин
 * (два срока по 90 с), дальше — запасной провайдер или ошибка. Прочие временные сбои — по общим паузам.
 */
const MAX_SILENCE_ATTEMPTS = 2;

/** Повторяются по коду всегда; любой код ≥ 500 — тоже. */
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429]);

/** Провайдер не начал отвечать за отведённый срок. */
export class FirstChunkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Модель не начала отвечать за ${timeoutMs} мс`);
    this.name = "FirstChunkTimeoutError";
  }
}

/** Провайдер начал отвечать и замолчал: между кусками прошёл срок тишины. */
export class StreamStallError extends Error {
  constructor(timeoutMs: number) {
    super(`Модель замолчала посреди ответа на ${timeoutMs} мс`);
    this.name = "StreamStallError";
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof FirstChunkTimeoutError || (error instanceof DOMException && error.name === "TimeoutError");
}

/** Провайдер молчит: не начал отвечать за срок или замолчал посреди ответа. */
export function isProviderSilence(error: unknown): boolean {
  return isTimeoutError(error) || error instanceof StreamStallError;
}

/**
 * Временная ли ошибка. Порядок общий с классификатором: «не повторять» (квота, оплата) → переполнение → «повторять».
 * `x-should-retry` провайдера главнее всего. Текстовые признаки — только когда кода нет: в тексте 4xx-ответа они лгут.
 */
function isTransient(error: unknown): boolean {
  if (isTimeoutError(error)) return true;
  const verdict = errorHeaders(error)?.["x-should-retry"];
  if (verdict === "true") return true;
  if (verdict === "false") return false;
  const status = errorStatusCode(error);
  const text = errorText(error);
  if (isNotRetryable(text, status) || isContextOverflow(text, status)) return false;
  if (status !== undefined) return RETRYABLE_STATUS_CODES.has(status) || status >= 500;
  if (APICallError.isInstance(error) && error.isRetryable) return true;
  return looksTransient(text);
}

/** Чей запрос повторяется — для строки журнала — и подменяемые в тестах часы, пауза и случайность. */
export interface TransientRetryContext {
  chatId?: string;
  modelId?: string;
  providerId?: string;
  /** Строка `[повтор]` на каждую попытку. Нет — повторы молчат. */
  logError?: (message: string) => void;
  /** Случайность разброса пауз, 0 ≤ x < 1. По умолчанию `Math.random`. */
  random?: () => number;
  /** Пауза перед повтором; обрывается сигналом отмены. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Текущее время, мс: для `retry-after` датой. */
  now?: () => number;
  /** Сроки молчания потока (FR-016, FR-022, FR-046). Нет — `DEFAULT_MODEL_SILENCE`. */
  silence?: ModelSilenceLimits;
  /**
   * `false` — молчание до первого куска у того же провайдера не повторяется: ход сразу переходит к следующему
   * (`providerFallback.onSilence: "restart-step-on-next"`). По умолчанию `true` — один повтор. Функция спрашивается при
   * каждом молчании: переходить ли есть куда, ход знает только в этот момент.
   */
  repeatSilence?: boolean | (() => boolean);
}

/**
 * Тихие повторы запроса к модели при временных ошибках — для потока только до первого куска ответа, для запроса без
 * потока (сжатие, склейка памяти) — весь запрос. Встроенный повтор SDK ждёт 2 + 4 + 8 с и не знает про срок первого
 * куска, поэтому свой. Срок первого куска и срок тишины тоже здесь: срок `streamText` отменяет весь ход, и повторить
 * после него нельзя.
 */
export function createTransientRetryMiddleware(context: TransientRetryContext = {}): LanguageModelV4Middleware {
  const random = context.random ?? Math.random;
  const pause = context.sleep ?? sleep;
  const now = context.now ?? Date.now;
  const silence = context.silence ?? DEFAULT_MODEL_SILENCE;
  const repeatSilence = context.repeatSilence ?? true;
  const silenceAttempts = () => ((typeof repeatSilence === "function" ? repeatSilence() : repeatSilence) ? MAX_SILENCE_ATTEMPTS : 1);
  /** Строка `[молчание модели]`, когда срок сработал: до первого куска или между кусками. */
  const onSilence = (waited: "первый-кусок" | "следующий-кусок", timeoutMs: number) =>
    context.logError?.(
      `[молчание модели] чат=${context.chatId ?? "нет"} модель=${context.modelId ?? "нет"} провайдер=${context.providerId ?? "нет"} ждали=${waited} срок=${timeoutMs}мс`,
    );

  async function withRetries<T>(attemptOnce: () => PromiseLike<T>, abortSignal: AbortSignal | undefined): Promise<T> {
    let waitedMs = 0;
    let silences = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await attemptOnce();
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (isTimeoutError(error)) silences++;
        if (abortSignal?.aborted || delay === undefined || !isTransient(error) || silences >= silenceAttempts()) throw error;
        const remainingMs = RETRY_BUDGET_MS - waitedMs;
        const pauseMs = requestedPauseMs(error, remainingMs, now()) ?? Math.round(Math.min(delay * (1 + random() * RETRY_JITTER), remainingMs));
        context.logError?.(retryLine(context, attempt + 2, error, pauseMs));
        await pause(pauseMs, abortSignal);
        waitedMs += pauseMs;
      }
    }
  }

  return {
    specificationVersion: "v4",
    wrapStream: ({ model, params }) => withRetries(() => streamUntilFirstChunk(model, params, silence, onSilence), params.abortSignal),
    wrapGenerate: ({ doGenerate, params }) => withRetries(doGenerate, params.abortSignal),
  };
}

/** Готовая обёртка без журнала. */
export const transientRetryMiddleware: LanguageModelV4Middleware = createTransientRetryMiddleware({});

/** `[повтор] чат=… модель=… провайдер=… попытка=2 код=503 пауза=3412мс`; без кода — имя ошибки. */
function retryLine(context: TransientRetryContext, attempt: number, error: unknown, pauseMs: number): string {
  const status = errorStatusCode(error);
  const reason = status !== undefined ? `код=${status}` : `имя=${errorName(error) ?? "нет"}`;
  return `[повтор] чат=${context.chatId ?? "нет"} модель=${context.modelId ?? "нет"} провайдер=${context.providerId ?? "нет"} попытка=${attempt} ${reason} пауза=${Math.round(pauseMs)}мс`;
}

/** Срок провайдера из `retry-after-ms` или `retry-after`, если он влезает в оставшийся запас; иначе — нет. */
function requestedPauseMs(error: unknown, remainingMs: number, nowMs: number): number | undefined {
  const requestedMs = requestedRetryMs(error, nowMs);
  return requestedMs === undefined || requestedMs > remainingMs ? undefined : requestedMs;
}

type OnSilence = (waited: "первый-кусок" | "следующий-кусок", timeoutMs: number) => void;

/**
 * Одна попытка: запрос и чтение до первого куска ответа. Ошибка или срок до него — отказ попытки.
 * Прочитанные до первого куска служебные куски отдаются дальше вместе с остатком потока. Срок `Infinity` — без таймера.
 */
async function streamUntilFirstChunk(
  model: LanguageModelV4,
  params: LanguageModelV4CallOptions,
  silence: ModelSilenceLimits,
  onSilence: OnSilence,
): Promise<LanguageModelV4StreamResult> {
  const timeoutMs = silence.firstChunkMs;
  const attempt = new AbortController();
  const outer = params.abortSignal;
  const abortAttempt = () => attempt.abort(outer?.reason);
  if (outer?.aborted) abortAttempt();
  outer?.addEventListener("abort", abortAttempt, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    if (Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        const timeout = new FirstChunkTimeoutError(timeoutMs);
        onSilence("первый-кусок", timeoutMs);
        attempt.abort(timeout);
        reject(timeout);
      }, timeoutMs);
    }
    attempt.signal.addEventListener("abort", () => reject(attempt.signal.reason), { once: true });
  });
  deadline.catch(() => {});
  const release = () => {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abortAttempt);
  };

  let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | undefined;
  try {
    const result = await Promise.race([model.doStream({ ...params, abortSignal: attempt.signal }), deadline]);
    reader = result.stream.getReader();
    const early: LanguageModelV4StreamPart[] = [];
    for (;;) {
      const read = await Promise.race([reader.read(), deadline]);
      if (read.done) break;
      if (read.value.type === "error") throw read.value.error;
      early.push(read.value);
      if (isFirstAnswerChunk(read.value)) break;
    }
    clearTimeout(timer);
    // Дальше отмену передаёт сам провайдер: сигнал попытки связан с внешним.
    const stall = { timeoutMs: silence.betweenChunksMs, onStall: () => onSilence("следующий-кусок", silence.betweenChunksMs) };
    return { ...result, stream: continueStream(early, reader, release, (reason) => attempt.abort(reason), stall) };
  } catch (error) {
    release();
    attempt.abort(error);
    void reader?.cancel(error).catch(() => {});
    throw error;
  }
}

/** Первый кусок ответа — то, что модель написала: текст, рассуждение, вызов или конец ответа. */
function isFirstAnswerChunk(part: LanguageModelV4StreamPart): boolean {
  switch (part.type) {
    case "text-delta":
    case "reasoning-delta":
    case "tool-input-delta":
      return part.delta.length > 0;
    case "tool-call":
    case "tool-result":
    case "file":
    case "source":
    case "finish":
      return true;
    default:
      return false;
  }
}

function continueStream(
  early: LanguageModelV4StreamPart[],
  reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>,
  release: () => void,
  abortAttempt: (reason: unknown) => void,
  /** Срок тишины между кусками; `Infinity` — без таймера. */
  stall: { timeoutMs: number; onStall: () => void },
): ReadableStream<LanguageModelV4StreamPart> {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index < early.length) {
        controller.enqueue(early[index++]!);
        return;
      }
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        if (!Number.isFinite(stall.timeoutMs)) return;
        stallTimer = setTimeout(() => {
          stall.onStall();
          reject(new StreamStallError(stall.timeoutMs));
        }, stall.timeoutMs);
      });
      try {
        const read = await Promise.race([reader.read(), stalled]);
        if (read.done) {
          release();
          controller.close();
        } else {
          controller.enqueue(read.value);
        }
      } catch (error) {
        release();
        if (error instanceof StreamStallError) {
          // Провайдер мог так и держать соединение: отменяем запрос, чтобы он не висел.
          abortAttempt(error);
          void reader.cancel(error).catch(() => {});
        }
        controller.error(error);
      } finally {
        clearTimeout(stallTimer);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });
}

/** Пауза, которую обрывает «Стоп»: отказ с причиной отмены. */
export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
