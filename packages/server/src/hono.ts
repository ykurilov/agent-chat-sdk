import type { Context, Hono } from "hono";
import type { ChatHandler } from "./chat-handler";

/** Монтирует обработчик чата (или расширения с такой же формой: `basePath` и `fetch`, например голоса) в приложение Hono по его `basePath`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- приложение может иметь любые свои Env и Schema
export function mountChat(app: Hono<any, any, any>, handler: Pick<ChatHandler, "basePath" | "fetch">): void {
  // Готовый Response Hono отдаёт как есть и теряет заголовки и cookie, которые приложение
  // выставило до `next()` (например, продлённую сессию). `newResponse` их добавляет.
  const forward = async (c: Context) => {
    const response = await handler.fetch(c.req.raw);
    return c.newResponse(response.body, response);
  };
  app.all(handler.basePath, forward);
  app.all(`${handler.basePath}/*`, forward);
}
