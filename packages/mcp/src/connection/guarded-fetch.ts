import { assertPublicWebAddress, assertResolvesPublic, createPinnedFetch as createSharedPinnedFetch, WebToolError } from "@ykurilov/agent-chat-web-tools/network";
import type { HostResolver, PinnedFetch } from "@ykurilov/agent-chat-web-tools/network";
import { McpError } from "../mcp-error";

export interface GuardedFetchOptions {
  fetch: typeof globalThis.fetch;
  /** `fetch` сам проверяет каждый адрес в момент соединения (`createPinnedFetch`): отдельной проверки DNS до запроса нет. */
  pinned?: boolean;
  resolveHost: HostResolver;
  /** Разрешить локальные и частные адреса (свой сервер MCP во внутренней сети). */
  allowPrivateNetwork: boolean;
  /** Предел тела ответа, байт: на весь ответ, а у потока SSE — на одно сообщение. */
  maxResponseBytes: number;
  /** Заголовки прокси приложения: только на адрес прокси `origin`, на другие адреса они не уходят. */
  proxyHeaders?: { origin: string; headers: Readonly<Record<string, string>> };
}

/**
 * Адрес сервера MCP: только http и https, без логина в адресе; локальный и частный — только с разрешения приложения.
 * Проверка без DNS: её проходит и форма админа, и каждый запрос.
 */
export function checkedServerAddress(address: string, allowPrivateNetwork: boolean): URL {
  if (allowPrivateNetwork) {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      throw new McpError("bad_address", "Неверный адрес сервера: нужен полный адрес с https://.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new McpError("bad_address", "Адрес сервера: поддерживаются только http:// и https://.");
    if (url.username || url.password) throw new McpError("bad_address", "Логин и пароль в адресе не поддерживаются: передайте их заголовком.");
    return url;
  }
  try {
    return assertPublicWebAddress(address);
  } catch (error) {
    throw asAddressError(error);
  }
}

function asAddressError(error: unknown): unknown {
  if (!(error instanceof WebToolError)) return error;
  const message = error.message.startsWith("Адрес локальный или частный")
    ? "Адрес сервера локальный или частный: во внутреннюю сеть ходить нельзя."
    : error.message.replace("Неверный адрес страницы", "Неверный адрес сервера").replace("Адрес не открылся", "Адрес сервера не открылся");
  return new McpError("bad_address", message);
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * Счётчик байт сообщения. Обычный ответ — одно сообщение. Поток SSE живёт долго и несёт много сообщений: считаем от
 * пустой строки, которой кончается каждое, — длинная связь не упирается в предел, а одно большое сообщение упирается.
 */
function messageBytes(eventStream: boolean) {
  let size = 0;
  let afterLineFeed = false;
  return (chunk: Uint8Array): number => {
    if (!eventStream) return (size += chunk.byteLength);
    let largest = size;
    for (const byte of chunk) {
      if (byte === CARRIAGE_RETURN) continue;
      if (byte === LINE_FEED && afterLineFeed) size = 0;
      else size += 1;
      afterLineFeed = byte === LINE_FEED;
      if (size > largest) largest = size;
    }
    return largest;
  };
}

/** Тело ответа обрывается, как только сообщение перевалило за предел: чужой сервер не забьёт память. */
function withBodyLimit(response: Response, maxBytes: number): Response {
  const declared = Number(response.headers.get("content-length") ?? "");
  const tooLarge = () => new McpError("too_large", `Ответ сервера больше ${Math.round(maxBytes / 1024)} КБ.`);
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body || NULL_BODY_STATUSES.has(response.status)) return response;
  const count = messageBytes((response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream"));
  const limited = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (count(chunk) > maxBytes) controller.error(tooLarge());
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * Встроенный `fetch` пакета — общий закреплённый `fetch` из `@ykurilov/agent-chat-web-tools/network`: имя разрешается и
 * проверяется в момент соединения, соединение идёт на проверенный адрес. Отказ — `McpError` вида `bad_address`.
 * `close` — закрыть соединения.
 */
export function createPinnedFetch(options: { resolveHost: HostResolver; allowPrivateNetwork: boolean }): PinnedFetch {
  const pinned = createSharedPinnedFetch(options);
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    try {
      return await pinned.fetch(input, init);
    } catch (error) {
      throw asAddressError(error);
    }
  };
  return { fetch, close: pinned.close };
}

/**
 * `fetch` для клиента MCP: каждый запрос (и адрес, который назовёт сам SSE-сервер) проходит проверку адреса и DNS,
 * переадресации запрещены, тело ответа ограничено. Закреплённый `fetch` (`pinned`) проверяет DNS сам при соединении;
 * свой `fetch` приложения (прокси) — проверка DNS перед запросом.
 */
export function guardedFetch(options: GuardedFetchOptions): typeof globalThis.fetch {
  return async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    const url = checkedServerAddress(address, options.allowPrivateNetwork);
    if (!options.allowPrivateNetwork && !options.pinned) {
      try {
        await assertResolvesPublic(url, options.resolveHost);
      } catch (error) {
        throw asAddressError(error);
      }
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (options.proxyHeaders && url.origin === options.proxyHeaders.origin) {
      for (const [name, value] of Object.entries(options.proxyHeaders.headers)) headers.set(name, value);
    }
    const response = await options.fetch(url.href, { ...init, headers, redirect: "error" });
    return withBodyLimit(response, options.maxResponseBytes);
  };
}
