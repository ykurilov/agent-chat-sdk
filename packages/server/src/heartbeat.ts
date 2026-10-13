import { JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS } from "ai";

/** Заголовок, по которому вкладка узнаёт, как часто сервер шлёт признак жизни. */
export const HEARTBEAT_HEADER = "x-agent-chat-heartbeat-ms";
export const MIN_HEARTBEAT_INTERVAL_MS = 1000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

const PING = new TextEncoder().encode(": ping\n\n");

/**
 * Ответ-поток из частей UI-сообщения с признаком жизни: SSE-комментарий `: ping` сразу и потом
 * каждые `heartbeatIntervalMs`. События приходят целиком (по одному на кусок), а пинг встаёт
 * только между ними. Клиент SDK комментарии пропускает, поэтому в сообщения и хранилище они
 * не попадают.
 */
export function createHeartbeatResponse(options: {
  stream: ReadableStream<unknown>;
  heartbeatIntervalMs: number;
}): Response {
  const { stream, heartbeatIntervalMs } = options;
  assertHeartbeatInterval(heartbeatIntervalMs);
  const events = stream.pipeThrough(new JsonToSseTransformStream()).getReader();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;
  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(PING);
      timer = setInterval(() => controller.enqueue(PING), heartbeatIntervalMs);
    },
    async pull(controller) {
      try {
        const { done, value } = await events.read();
        // Читатель ушёл, пока чтение висело: поток уже отменён, закрывать и писать в него нельзя.
        if (cancelled) return;
        if (done) {
          stopTimer();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (error) {
        stopTimer();
        throw error;
      }
    },
    cancel(reason) {
      cancelled = true;
      stopTimer();
      return events.cancel(reason);
    },
  });
  return new Response(body, {
    headers: { ...UI_MESSAGE_STREAM_HEADERS, [HEARTBEAT_HEADER]: String(heartbeatIntervalMs) },
  });
}

export function assertHeartbeatInterval(heartbeatIntervalMs: number): void {
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs < MIN_HEARTBEAT_INTERVAL_MS) {
    throw new RangeError(
      `heartbeatIntervalMs должен быть не меньше ${MIN_HEARTBEAT_INTERVAL_MS} мс, получено ${heartbeatIntervalMs}`,
    );
  }
}
