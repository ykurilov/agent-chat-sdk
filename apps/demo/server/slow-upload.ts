import type { MiddlewareHandler } from "hono";

/**
 * Медленный приём файлов для проверки прогресса загрузки: cookie `demo-slow-upload` — сколько байт в секунду сервер
 * читает из тела загрузки. Браузер отправляет не быстрее, чем сервер читает, поэтому его прогресс отправки растёт
 * постепенно, как на медленной сети. Без cookie — обычный приём.
 */
export function slowUploads(readCookie: (request: Request, name: string) => string | undefined): MiddlewareHandler {
  return async (c, next) => {
    const bytesPerSecond = Number(readCookie(c.req.raw, "demo-slow-upload"));
    const body = c.req.raw.body;
    if (c.req.method === "POST" && body && bytesPerSecond > 0 && /\/attachments$/.test(c.req.path)) {
      c.req.raw = new Request(c.req.raw, { body: throttled(body, bytesPerSecond), duplex: "half" } as RequestInit);
    }
    await next();
  };
}

const step = 0.05;

function throttled(source: ReadableStream<Uint8Array>, bytesPerSecond: number): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const portion = Math.max(1, Math.round(bytesPerSecond * step));
  let rest: Uint8Array | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!rest?.length) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        rest = value;
      }
      await new Promise((resolve) => setTimeout(resolve, step * 1000));
      controller.enqueue(rest.subarray(0, portion));
      rest = rest.subarray(portion);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
