import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";
import { findMcpError, McpError } from "../mcp-error";
import type { ListedTool } from "../snapshot/tool-snapshot";
import type { McpTransportKind } from "../types";

/** Куда и как подключаться: адрес и заголовки уже расшифрованы. Живёт только в памяти процесса. */
export interface ServerEndpoint {
  name: string;
  url: string;
  transport: McpTransportKind;
  headers: Readonly<Record<string, string>>;
  timeoutMs: number;
  /** `fetch` с проверкой адресов, пределом ответа и, если надо, прокси. */
  fetch: typeof globalThis.fetch;
  /** Вычистка секретов из текста ошибки. */
  scrub: (text: string) => string;
}

/** Ответ `tools/call`, как его прислал сервер. */
export interface McpCallResult {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Больше страниц `tools/list` не читаем: сервер с бесконечным списком не повесит админа. */
const MAX_LIST_PAGES = 20;
/** Больше инструментов в снимок не берём. */
const MAX_LISTED_TOOLS = 300;

/** Связь с одним сервером: клиент живёт между вызовами; после сбоя закрывается, следующий вызов подключается заново. */
export interface ServerConnection {
  listTools(signal?: AbortSignal): Promise<ListedTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
  /** Вычистка секретов этого сервера (адрес, заголовки) из текста, который он прислал. */
  scrub(text: string): string;
  close(): Promise<void>;
}

export function createServerConnection(endpoint: ServerEndpoint): ServerConnection {
  let client: Promise<MCPClient> | null = null;

  function connect(signal: AbortSignal): Promise<MCPClient> {
    client ??= createMCPClient({
      transport: { type: endpoint.transport, url: endpoint.url, headers: { ...endpoint.headers }, redirect: "error", fetch: endpoint.fetch },
      clientName: "agent-chat-mcp",
      initializationOptions: { signal, timeout: endpoint.timeoutMs },
      // Ошибки фонового потока (SSE) приходят сюда; вызов узнает о них сам — не пишем их как необработанные.
      onUncaughtError: () => {},
    });
    return client;
  }

  async function dropClient() {
    const current = client;
    client = null;
    if (current) await current.then((ready) => ready.close()).catch(() => {});
  }

  /** Один запрос к серверу со сроком: сбой — понятная `McpError` без секретов, клиент сбрасывается. */
  async function withClient<T>(signal: AbortSignal | undefined, work: (ready: MCPClient, signal: AbortSignal) => Promise<T>): Promise<T> {
    const deadline = AbortSignal.timeout(endpoint.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      return await work(await connect(combined), combined);
    } catch (error) {
      await dropClient();
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new McpError("unavailable", "Вызов остановлен.");
      if (deadline.aborted) throw new McpError("timeout", `Сервер «${endpoint.name}» не ответил за ${Math.round(endpoint.timeoutMs / 1000)} с.`);
      const known = findMcpError(error);
      if (known) throw new McpError(known.kind, endpoint.scrub(known.message));
      const text = error instanceof Error ? error.message : String(error);
      throw new McpError("unavailable", endpoint.scrub(`Сервер «${endpoint.name}» недоступен: ${text}`));
    }
  }

  return {
    listTools(signal) {
      return withClient(signal, async (ready, combined) => {
        const tools: ListedTool[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_LIST_PAGES; page++) {
          const result = await ready.listTools({ ...(cursor !== undefined && { params: { cursor } }), options: { signal: combined, timeout: endpoint.timeoutMs } });
          tools.push(...(result.tools as ListedTool[]));
          cursor = result.nextCursor;
          if (cursor === undefined || tools.length >= MAX_LISTED_TOOLS) break;
        }
        return tools.slice(0, MAX_LISTED_TOOLS);
      });
    },
    callTool(name, args, signal) {
      return withClient(signal, async (ready, combined) => {
        const result = await ready.callTool({ name, arguments: args, options: { signal: combined, timeout: endpoint.timeoutMs } });
        return result as McpCallResult;
      });
    },
    scrub: endpoint.scrub,
    close: dropClient,
  };
}
