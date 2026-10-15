import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { createMcpAdminHandler, createMcpServers } from "@ykurilov/agent-chat-mcp";
import { createSqliteMcpStore } from "@ykurilov/agent-chat-mcp/sqlite";

interface DemoMcpOptions {
  model: string;
  databaseFile: string;
  env: Record<string, string | undefined>;
  storage: ChatStorage;
  isAdmin(userId: string): boolean | Promise<boolean>;
}

/**
 * Серверы MCP, которые подключает админ стенда (экран `/mcp`, адреса `/api/mcp`). В `mock` разрешена внутренняя сеть:
 * поддельный сервис MCP живёт на этом же сервере (`/api/demo/mcp`). Ключ шифрования — `DEMO_MCP_SECRET_KEY`; без него —
 * случайный на этот запуск: серверы, добавленные раньше, после перезапуска не откроются.
 */
export async function createDemoMcp(options: DemoMcpOptions) {
  return createMcpServers({
    store: await createSqliteMcpStore({ filePath: options.databaseFile }),
    secretKey: options.env.DEMO_MCP_SECRET_KEY ?? launchSecretKey(),
    isAdmin: options.isAdmin,
    allowPrivateNetwork: options.model === "mock",
    spending: { storage: options.storage },
  });
}

/** Ключа в окружении нет: случайный на запуск, а не общий из кода. */
function launchSecretKey(): string {
  console.warn("[demo] DEMO_MCP_SECRET_KEY не задан: ключ серверов MCP случайный на этот запуск, сохранённые раньше серверы не откроются");
  return randomBytes(32).toString("base64url");
}

export function createDemoMcpAdmin(mcp: Awaited<ReturnType<typeof createDemoMcp>>, resolveUser: (request: Request) => Promise<{ id: string } | null>, allowedOrigins: string[]) {
  return createMcpAdminHandler({ mcp, resolveUser, allowedOrigins, logError: (error) => console.error(error) });
}

const mockTools = [
  {
    name: "search_docs",
    title: "Поиск по документации",
    description: "Ищет ответ в документации стенда по вопросу.",
    inputSchema: { type: "object", properties: { question: { type: "string", description: "Вопрос" } }, required: ["question"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_ticket",
    title: "Создать заявку",
    description: "Создаёт заявку в поддержку.",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
];

/** Поддельный сервис MCP стенда: Streamable HTTP без сессий, два инструмента. */
export function createMockMcpService() {
  const app = new Hono();
  app.get("/", (c) => c.body(null, 405));
  app.delete("/", (c) => c.body(null, 200));
  app.post("/", async (c) => {
    const message = (await c.req.json()) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    const reply = (result: unknown) => c.json({ jsonrpc: "2.0", id: message.id, result });
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "demo-docs", version: "1.0.0" } });
      case "notifications/initialized":
        return c.body(null, 202);
      case "tools/list":
        return reply({ tools: mockTools });
      case "tools/call": {
        const args = message.params?.arguments ?? {};
        const text =
          message.params?.name === "search_docs" ? `В документации стенда про «${String(args.question ?? "")}»: ответ из поддельного сервиса.` : `Заявка «${String(args.title ?? "")}» создана.`;
        return reply({ content: [{ type: "text", text }] });
      }
      default:
        return c.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    }
  });
  return app;
}
