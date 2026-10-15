import { allowedUser, createRequestOriginCheck, isSafeMethod, originRefusalHint } from "@ykurilov/agent-chat-core";
import type { ResolvedUser } from "@ykurilov/agent-chat-core";
import { McpError } from "./mcp-error";
import type { McpErrorKind } from "./mcp-error";
import type { McpServers } from "./mcp-servers";

export interface McpAdminHandlerOptions {
  mcp: McpServers;
  /** Кто спрашивает: та же функция, что у обработчика чата. Админ ли — решает `isAdmin` из `createMcpServers`. */
  resolveUser: (request: Request) => Promise<ResolvedUser>;
  /** По умолчанию `/api/mcp`. */
  basePath?: string;
  /** Свои адреса страниц для запросов на запись, как у обработчика чата. */
  allowedOrigins?: readonly string[];
  logError?: (message: string) => void;
}

/** Обработчик адресов экрана админа: монтируется как обработчик чата (`mountChat(app, handler)`). */
export interface McpAdminHandler {
  basePath: string;
  fetch(request: Request): Promise<Response>;
}

/** Тело запроса больше этого не читается: форма сервера — это несколько строк. */
const MAX_BODY_BYTES = 64 * 1024;

const statusOf: Record<McpErrorKind, number> = {
  bad_input: 400,
  bad_address: 400,
  not_found: 404,
  not_allowed: 403,
  limit: 429,
  unavailable: 502,
  timeout: 504,
  too_large: 502,
  tool_error: 502,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const notFound = () => json(404, { error: { kind: "not_found" } });

/** Тело как текст, но не больше `MAX_BODY_BYTES` байт: лишнее не читается, поток обрывается. */
async function readLimitedText(request: Request): Promise<string> {
  const tooLarge = () => new McpError("bad_input", "Слишком большой запрос.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await readLimitedText(request);
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new McpError("bad_input", "Тело запроса — не JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new McpError("bad_input", "Тело запроса — объект JSON.");
  return body as Record<string, unknown>;
}

/**
 * Адреса экрана «Серверы MCP» (все ответы без секретов):
 * `GET/POST {base}/servers`, `GET/PATCH/DELETE {base}/servers/:id`, `POST {base}/servers/:id/check`,
 * `POST {base}/servers/:id/refresh`, `PATCH {base}/servers/:id/tools/:name`, `GET {base}/calls?serverId=&limit=`.
 * Не-админ и не вошедший получают 404 на любом адресе.
 */
export function createMcpAdminHandler(options: McpAdminHandlerOptions): McpAdminHandler {
  const basePath = (options.basePath ?? "/api/mcp").replace(/\/+$/, "");
  const logError = options.logError ?? ((message: string) => console.error(message));
  const allowsOrigin = createRequestOriginCheck({
    allowedOrigins: options.allowedOrigins,
    onRefused: (refusal) => logError(`MCP: ${originRefusalHint(refusal)}`),
  });
  const { admin } = options.mcp;

  async function route(request: Request, segments: string[]): Promise<Response> {
    const method = request.method;
    const [first, id, third, toolName] = segments;
    if (first === "servers" && id === undefined) {
      if (method === "GET") return json(200, { servers: admin.listServers() });
      if (method === "POST") return json(201, { server: await admin.addServer((await readBody(request)) as never) });
    }
    if (first === "servers" && id !== undefined && third === undefined) {
      if (method === "GET") {
        const server = admin.getServer(id);
        return server ? json(200, { server }) : notFound();
      }
      if (method === "PATCH") return json(200, { server: await admin.updateServer(id, (await readBody(request)) as never) });
      if (method === "DELETE") {
        if (!admin.getServer(id)) return notFound();
        await admin.deleteServer(id);
        return json(200, { ok: true });
      }
    }
    if (first === "servers" && id !== undefined && segments.length === 3 && method === "POST") {
      if (third === "check") {
        const check = await admin.checkServer(id);
        return json(200, { check, server: admin.getServer(id) });
      }
      if (third === "refresh") return json(200, { server: await admin.refreshTools(id) });
    }
    if (first === "servers" && id !== undefined && third === "tools" && toolName !== undefined && segments.length === 4 && method === "PATCH") {
      const body = await readBody(request);
      return json(200, { server: await admin.setTool(id, toolName, body as never) });
    }
    if (first === "calls" && segments.length === 1 && method === "GET") {
      const query = new URL(request.url).searchParams;
      const serverId = query.get("serverId");
      const limit = Number(query.get("limit") ?? "50");
      return json(200, { calls: await admin.listCalls({ ...(serverId && { serverId }), limit: Number.isFinite(limit) ? limit : 50 }) });
    }
    return notFound();
  }

  return {
    basePath,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return notFound();
      try {
        const user = allowedUser(await options.resolveUser(request));
        // Не-админ не должен узнать, что экран есть: 404 до любых других проверок.
        if (!user || !(await options.mcp.isAdmin(user.id))) return notFound();
        if (!isSafeMethod(request.method) && !allowsOrigin(request)) return json(403, { error: { kind: "forbidden_origin" } });
        const segments = pathname.slice(basePath.length).split("/").filter(Boolean).map(decodeURIComponent);
        // Экран видит правки с других копий приложения сразу, а не через срок сверки.
        await options.mcp.sync();
        return await route(request, segments);
      } catch (error) {
        if (error instanceof McpError) return json(statusOf[error.kind], { error: { kind: error.kind, message: error.message } });
        logError(`MCP: сбой адреса ${request.method} ${pathname}: ${error instanceof Error ? error.message : String(error)}`);
        return json(500, { error: { kind: "other" } });
      }
    },
  };
}
