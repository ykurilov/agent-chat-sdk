import type { ChatHandler } from "./chat-handler";

type RouteHandler = (request: Request) => Promise<Response>;

const routeMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

/** Методы для файла маршрута Next.js (App Router): `export const { GET, POST, … } = createNextRouteHandlers(handler)`. */
export type NextRouteHandlers = Record<(typeof routeMethods)[number], RouteHandler>;

/** Отдаёт обработчик чата (или расширения с такой же формой: `basePath` и `fetch`) как обработчики маршрута Next.js; ответ идёт как есть, поток не буферизуется. */
export function createNextRouteHandlers(handler: Pick<ChatHandler, "fetch">): NextRouteHandlers {
  const forward: RouteHandler = (request) => handler.fetch(request);
  return Object.fromEntries(routeMethods.map((method) => [method, forward])) as NextRouteHandlers;
}
