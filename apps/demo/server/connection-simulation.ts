import type { MiddlewareHandler } from "hono";

/*
 * Имитация неполадок связи для стенда (e2e живой связи). В модуль не входит:
 * демо-сервер сам придерживает байты потоков ответа, а вкладка видит зависшую связь.
 *   normal      — всё как обычно;
 *   freeze-open — потоки, открытые в момент переключения, замирают; новые работают как обычно;
 *   silent      — замирают все потоки, и старые, и новые.
 */

export const connectionModes = ["normal", "freeze-open", "silent"] as const;
export type ConnectionMode = (typeof connectionModes)[number];

export function parseConnectionMode(value: unknown): ConnectionMode | null {
  return connectionModes.find((known) => known === value) ?? null;
}

const EVENT_STREAM = "text/event-stream";

export function createConnectionSimulation() {
  let mode: ConnectionMode = "normal";
  let openedCount = 0;
  /** Потоки с номером не больше этого замирают в режиме freeze-open. */
  let frozenUpTo = 0;
  let waiters: Array<() => void> = [];

  const wakeAll = () => {
    const ready = waiters;
    waiters = [];
    for (const wake of ready) wake();
  };

  const isHeld = (streamNumber: number) => mode === "silent" || (mode === "freeze-open" && streamNumber <= frozenUpTo);

  function setMode(next: ConnectionMode) {
    mode = next;
    if (next === "freeze-open") frozenUpTo = openedCount;
    wakeAll();
  }

  /** Ждёт, пока байты потока можно отпускать; отмена потока тоже будит ожидание. */
  async function untilReleased(streamNumber: number, cancelled: () => boolean) {
    while (isHeld(streamNumber) && !cancelled()) await new Promise<void>((resolve) => waiters.push(resolve));
  }

  function holdingBody(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const streamNumber = ++openedCount;
    const reader = source.getReader();
    let cancelled = false;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        await untilReleased(streamNumber, () => cancelled);
        if (!cancelled) controller.enqueue(value);
      },
      async cancel(reason) {
        cancelled = true;
        wakeAll();
        await reader.cancel(reason);
      },
    });
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    await next();
    const response = c.res;
    if (!response.body || !response.headers.get("content-type")?.includes(EVENT_STREAM)) return;
    c.res = new Response(holdingBody(response.body), response);
  };

  return { middleware, setMode, mode: () => mode };
}
