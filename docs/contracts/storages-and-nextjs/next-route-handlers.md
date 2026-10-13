# Contract: `@ykurilov/agent-chat-server/next`

```ts
// app/api/chat/[[...path]]/route.ts
import { createNextRouteHandlers } from "@ykurilov/agent-chat-server/next";
import { chatHandler } from "@/lib/chat"; // createChatHandler({ basePath: "/api/chat", … })

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } = createNextRouteHandlers(chatHandler);
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

- `createNextRouteHandlers(handler: ChatHandler)` → `Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD", (request: Request) => Promise<Response>>`.
- Ответ обработчика чата отдаётся без изменений (тело-поток, заголовки, статус).
- Адреса, коды и правила — [http-api.md](../basic-agent-dialog/http-api.md); отличий от Hono нет.
- `basePath` обработчика совпадает с путём маршрута.
- Пакет не импортирует `next`; `next` в его зависимостях нет.
