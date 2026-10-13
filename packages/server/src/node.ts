import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ChatHandler } from "./chat-handler";

/** Запрос Node, как его отдают `node:http` и Express: разборщик тела мог положить его в `body`. */
type NodeRequest = IncomingMessage & { originalUrl?: string; body?: unknown };

/** Слушатель для `http.createServer` и промежуточный обработчик Express: `app.use(toNodeListener(handler))`. */
export type NodeListener = (req: IncomingMessage, res: ServerResponse, next?: (error?: unknown) => void) => void;

/**
 * Отдаёт обработчик чата (или расширения с такой же формой: `basePath` и `fetch`) как слушатель Node.
 * Адрес вне `basePath` — `next()`, без `next` — 404. Тело запроса идёт потоком; уже прочитанное разборщиком (`req.body`)
 * уходит как есть. Ответ пишется по кускам, без буфера. Разрыв соединения до конца ответа отменяет запрос
 * (`request.signal`) и поток ответа.
 */
export function toNodeListener(handler: Pick<ChatHandler, "basePath" | "fetch">): NodeListener {
  return (req, res, next) => {
    const request = req as NodeRequest;
    const aborter = new AbortController();
    let built: Request;
    try {
      const url = requestUrl(request);
      if (url.pathname !== handler.basePath && !url.pathname.startsWith(`${handler.basePath}/`)) {
        if (next) next();
        else res.writeHead(404).end();
        return;
      }
      built = toRequest(request, url, aborter.signal);
    } catch {
      // Кривой адрес или заголовок: ответ клиенту, процесс не падает.
      res.writeHead(400).end();
      return;
    }
    res.on("close", () => {
      if (!res.writableFinished) aborter.abort();
    });
    forward(handler, built, res, aborter.signal).catch((error: unknown) => {
      // Клиент ушёл: ошибка — следствие отмены, сообщать некому.
      if (aborter.signal.aborted) return;
      if (next) return next(error);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  };
}

/**
 * Адрес запроса на базе `http://localhost`: заголовок Host присылает клиент, и кривой Host ронял бы разбор. Сам Host
 * уходит обработчику заголовком (проверка страницы-источника смотрит на него).
 */
function requestUrl(req: NodeRequest): URL {
  const path = req.originalUrl ?? req.url ?? "/";
  return path.startsWith("/") ? new URL(`http://localhost${path}`) : new URL(path, "http://localhost");
}

function toRequest(req: NodeRequest, url: URL, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers, signal });
  const parsed = parsedBody(req, headers);
  if (parsed !== undefined) return new Request(url, { method, headers, body: parsed, signal });
  return new Request(url, { method, headers, body: Readable.toWeb(req) as ReadableStream<Uint8Array>, signal, duplex: "half" } as RequestInit);
}

/** Тело, которое уже прочитал разборщик приложения; поток тогда пуст. Не прочитано — `undefined`. */
function parsedBody(req: NodeRequest, headers: Headers): BodyInit | undefined {
  if (req.body === undefined || !req.readableEnded) return undefined;
  // Длина и сжатие исходного тела к пересобранному не относятся.
  headers.delete("content-length");
  headers.delete("content-encoding");
  if (typeof req.body === "string") return req.body;
  if (req.body instanceof Uint8Array) return new Uint8Array(req.body);
  return JSON.stringify(req.body);
}

async function forward(handler: Pick<ChatHandler, "fetch">, request: Request, res: ServerResponse, signal: AbortSignal): Promise<void> {
  const response = await handler.fetch(request);
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  res.writeHead(response.status, response.statusText, headers);
  if (!response.body) {
    res.end();
    return;
  }
  // Заголовки потока уходят сразу: клиент видит ответ до первого куска.
  res.flushHeaders();
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel(signal.reason).catch(() => {});
  if (signal.aborted) return cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      if (!res.write(read.value)) await drained(res);
      if (signal.aborted) return;
    }
    res.end();
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** Ждёт, пока ответ примет следующий кусок или закроется; оба слушателя снимаются, чтобы не копиться за поток. */
function drained(res: ServerResponse): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });
}
