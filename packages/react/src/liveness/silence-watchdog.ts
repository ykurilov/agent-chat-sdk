import { ConnectionSilentError } from "./connection-errors";

const CHECK_EVERY_MS = 1000;

/** Действующий срок тишины: не меньше трёх признаков жизни сервера (FR-017). */
export function effectiveSilenceTimeoutMs(silenceTimeoutMs: number, heartbeatMs: number): number {
  return Math.max(silenceTimeoutMs, 3 * heartbeatMs);
}

export interface SilenceWatchOptions {
  silenceTimeoutMs: number;
  /** Срок до самого первого байта, если он короче: сервер шлёт пинг сразу после заголовков. */
  firstByteTimeoutMs?: number;
  onFirstByte?: () => void;
  /** Тишина затянулась: закрыть исходное соединение и сообщить наверх. */
  onSilence?: () => void;
  /** Во что превратить ошибку чтения тела перед тем, как отдать её читателю. */
  translateError?: (error: unknown) => unknown;
  /** Тело закончилось любым способом: конец, ошибка, тишина или отмена читателем. */
  onEnd?: () => void;
}

/**
 * Пропускает тело ответа как есть (ошибки чтения — через `translateError`), но следит за временем последнего байта (любого, и пинга тоже).
 * Тишина дольше срока — поток обрывается `ConnectionSilentError`, исходное соединение отменяется.
 * Сравнение времён, а не «таймер на 30 с»: фоновая вкладка и сон телефона не рвут живой поток,
 * а проснувшись — замечают тишину сразу (`visibilitychange`, `online`).
 */
export function watchSilence(body: ReadableStream<Uint8Array>, options: SilenceWatchOptions): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let lastByteAt = Date.now();
  let gotFirstByte = false;
  let finished = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  const stop = () => {
    finished = true;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("online", check);
    options.onEnd?.();
  };
  function check() {
    if (finished) return;
    const limit = gotFirstByte ? options.silenceTimeoutMs : (options.firstByteTimeoutMs ?? options.silenceTimeoutMs);
    const silentFor = Date.now() - lastByteAt;
    if (silentFor < limit) return;
    stop();
    void reader.cancel().catch(() => {});
    options.onSilence?.();
    controllerRef?.error(new ConnectionSilentError(silentFor));
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      timer = setInterval(check, CHECK_EVERY_MS);
      document.addEventListener("visibilitychange", check);
      window.addEventListener("online", check);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) {
          stop();
          controller.close();
          return;
        }
        lastByteAt = Date.now();
        if (!gotFirstByte) {
          gotFirstByte = true;
          options.onFirstByte?.();
        }
        controller.enqueue(value);
      } catch (error) {
        if (finished) return;
        stop();
        throw options.translateError ? options.translateError(error) : error;
      }
    },
    cancel(reason) {
      stop();
      return reader.cancel(reason);
    },
  });
}
