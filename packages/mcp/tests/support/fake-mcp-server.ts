/** Инструмент поддельного сервера: как его отдаёт `tools/list`. */
export interface FakeTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

export type FakeCallResult = Record<string, unknown>;

export interface FakeServerOptions {
  tools?: FakeTool[];
  /** Ответ на `tools/call`; по умолчанию — текст «ok». */
  onCall?: (name: string, args: Record<string, unknown>, request: Request) => FakeCallResult | Promise<FakeCallResult>;
  /** Сколько инструментов на страницу `tools/list`; по умолчанию все сразу. */
  pageSize?: number;
  /** Свой HTTP-ответ на метод JSON-RPC (ошибка 500, огромное тело…); `undefined` — обычный ответ. */
  override?: (rpcMethod: string, request: Request) => Response | undefined;
}

/** Запрос к поддельному серверу: адрес, метод JSON-RPC и заголовки. */
export interface SeenRequest {
  url: string;
  httpMethod: string;
  rpcMethod?: string;
  headers: Record<string, string>;
}

/**
 * Сервер MCP без сети: отвечает на Streamable HTTP (старый протокол с `initialize`), как DeepWiki. Подставляется в
 * `fetch` пакета. `down = true` — сервер «упал»: соединение рвётся.
 */
export function createFakeMcpServer(options: FakeServerOptions = {}) {
  const state = {
    tools: options.tools ?? [],
    down: false,
    requests: [] as SeenRequest[],
    calls: [] as { name: string; args: Record<string, unknown> }[],
  };

  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, ...init, headers: { "content-type": "application/json", ...init.headers } });

  async function handle(request: Request): Promise<Response> {
    const headers = Object.fromEntries(request.headers.entries());
    if (state.down) {
      state.requests.push({ url: request.url, httpMethod: request.method, headers });
      throw new TypeError("fetch failed: connect ECONNREFUSED");
    }
    if (request.method === "GET") {
      state.requests.push({ url: request.url, httpMethod: "GET", headers });
      return new Response(null, { status: 405 });
    }
    if (request.method === "DELETE") return new Response(null, { status: 200 });
    const message = (await request.json()) as { id?: number; method: string; params?: Record<string, unknown> };
    state.requests.push({ url: request.url, httpMethod: "POST", rpcMethod: message.method, headers });
    const overridden = options.override?.(message.method, request);
    if (overridden) return overridden;
    const reply = (result: unknown) => json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "mcp-session-id": "fake-session" } });

    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1.0.0" } });
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list": {
        const cursor = Number((message.params?.cursor as string | undefined) ?? 0);
        const size = options.pageSize ?? state.tools.length;
        const page = state.tools.slice(cursor, cursor + size);
        const next = cursor + size < state.tools.length ? String(cursor + size) : undefined;
        return reply({
          tools: page.map((tool) => ({ inputSchema: { type: "object", properties: {} }, ...tool })),
          ...(next !== undefined && { nextCursor: next }),
        });
      }
      case "tools/call": {
        const name = message.params?.name as string;
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        state.calls.push({ name, args });
        const result = options.onCall ? await options.onCall(name, args, request) : { content: [{ type: "text", text: "ok" }] };
        return reply(result);
      }
      default:
        // `server/discover` нового протокола и всё прочее: «нет такого метода» — клиент переходит на `initialize`.
        return json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    }
  }

  const seenInits: (RequestInit | undefined)[] = [];
  /** Как настоящий `fetch`: отмена сигналом обрывает ожидание ответа. */
  const fetch: typeof globalThis.fetch = (input, init) => {
    seenInits.push(init);
    const signal = init?.signal;
    if (signal?.aborted) return Promise.reject(signal.reason);
    const answer = handle(new Request(input, init));
    if (!signal) return answer;
    return new Promise<Response>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      answer.then(resolve, reject);
    });
  };
  // Не разворачивать `...`: геттеры скопировались бы значениями, и смена `tools`/`down` не дошла бы до сервера.
  return Object.assign(stateAccess(state), { fetch, seenInits });
}

function stateAccess(state: { tools: FakeTool[]; down: boolean; requests: SeenRequest[]; calls: { name: string; args: Record<string, unknown> }[] }) {
  return {
    get tools() {
      return state.tools;
    },
    set tools(tools: FakeTool[]) {
      state.tools = tools;
    },
    get down() {
      return state.down;
    },
    set down(value: boolean) {
      state.down = value;
    },
    get requests() {
      return state.requests;
    },
    get calls() {
      return state.calls;
    },
  };
}

/** Резолвер DNS для тестов: любое имя — публичный адрес. */
export const publicResolver = async () => ["93.184.216.34"];
