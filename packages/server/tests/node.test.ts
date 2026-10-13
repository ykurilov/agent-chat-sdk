import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toNodeListener } from "../src/node";
import { createGate } from "./support/mock-catalog";
import { readAll, readUntil } from "./support/sse";
import { createTestChat, message } from "./support/test-chat";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** Настоящий сервер node:http на свободном порту; отдаёт адрес. */
async function listen(listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (url: string, body?: unknown, user = "anna") =>
  fetch(url, {
    method: "POST",
    headers: { "x-user": user, ...(body !== undefined && { "content-type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

describe("toNodeListener", () => {
  it("тело запроса доходит, ответ с кодом и JSON: создание чата и история", async () => {
    const { handler } = createTestChat({ chatList: true });
    const origin = await listen(toNodeListener(handler));
    const created = await post(`${origin}/api/chat`);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const renamed = await fetch(`${origin}/api/chat/${id}`, {
      method: "PATCH",
      headers: { "x-user": "anna", "content-type": "application/json" },
      body: JSON.stringify({ title: "Своё имя" }),
    });
    expect(renamed.status).toBeLessThan(300);
    const history = await fetch(`${origin}/api/chat/${id}`, { headers: { "x-user": "anna" } });
    expect(await history.json()).toMatchObject({ chat: { id, title: "Своё имя" }, messages: [] });
  });

  it("ответ идёт потоком: первый кусок приходит, пока модель ещё ждёт", async () => {
    const gate = createGate();
    const { handler } = createTestChat({ gate: gate.wait });
    const origin = await listen(toNodeListener(handler));
    const { id } = (await (await post(`${origin}/api/chat`)).json()) as { id: string };
    const response = await post(`${origin}/api/chat/${id}/messages`, message("u1", "Привет"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const seen = await readUntil(reader, '"type":"start"');
    gate.open();
    expect((await readAll(reader, seen)).map((part) => part.type)).toContain("finish");
  });

  it("разрыв соединения отменяет запрос и поток ответа", async () => {
    let signal: AbortSignal | undefined;
    const cancelled = vi.fn();
    const handler = {
      basePath: "/api/chat",
      fetch: async (request: Request) => {
        signal = request.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => controller.enqueue(new TextEncoder().encode("data: первый\n\n")),
            cancel: cancelled,
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    };
    const origin = await listen(toNodeListener(handler));
    const client = new AbortController();
    const response = await fetch(`${origin}/api/chat/x`, { signal: client.signal });
    await readUntil(response.body!.getReader(), "первый");
    client.abort();
    await expect.poll(() => signal?.aborted).toBe(true);
    await expect.poll(() => cancelled.mock.calls.length).toBe(1);
  });

  it("заголовки: несколько Set-Cookie не склеиваются, запрос видит свои заголовки и адрес", async () => {
    let seen: Request | undefined;
    const handler = {
      basePath: "/api/chat",
      fetch: async (request: Request) => {
        seen = request;
        const headers = new Headers({ "content-type": "text/plain" });
        headers.append("set-cookie", "a=1; Path=/");
        headers.append("set-cookie", "b=2; Path=/");
        return new Response("ок", { status: 202, headers });
      },
    };
    const origin = await listen(toNodeListener(handler));
    const response = await fetch(`${origin}/api/chat/x?y=1`, { headers: { "x-user": "anna" } });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("ок");
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(new URL(seen!.url).pathname + new URL(seen!.url).search).toBe("/api/chat/x?y=1");
    expect(seen!.headers.get("x-user")).toBe("anna");
  });

  it("чужой адрес: есть next — дальше по цепочке, нет — 404", async () => {
    const { handler } = createTestChat();
    const listener = toNodeListener(handler);
    const next = vi.fn((_error?: unknown) => {});
    const withNext = await listen((req, res) => {
      listener(req, res, next);
      if (next.mock.calls.length > 0) res.writeHead(418).end();
    });
    expect((await fetch(`${withNext}/other`)).status).toBe(418);
    expect(next).toHaveBeenCalledWith();
    const alone = await listen(listener);
    expect((await fetch(`${alone}/other`)).status).toBe(404);
  });

  it("тело уже прочитано разборщиком (Express: req.body) — уходит обработчику; адрес — originalUrl", async () => {
    let body: unknown;
    let path = "";
    const handler = {
      basePath: "/api/chat",
      fetch: async (request: Request) => {
        body = await request.json();
        path = new URL(request.url).pathname;
        return new Response(null, { status: 204 });
      },
    };
    const listener = toNodeListener(handler);
    const origin = await listen((req: IncomingMessage, res: ServerResponse) => {
      // Как express.json() и app.use("/api/chat", …): тело прочитано, url укорочен.
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => {
        Object.assign(req, { body: JSON.parse(raw), originalUrl: req.url, url: req.url!.slice("/api/chat".length) });
        listener(req, res);
      });
    });
    const response = await post(`${origin}/api/chat/abc`, { hello: "мир" });
    expect(response.status).toBe(204);
    expect(body).toEqual({ hello: "мир" });
    expect(path).toBe("/api/chat/abc");
  });

  it("кривой заголовок Host не роняет процесс: ответ 400, сервер жив", async () => {
    const { handler } = createTestChat();
    const origin = await listen(toNodeListener(handler));
    const { port } = new URL(origin);
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(port), "127.0.0.1", () => socket.write("GET /api/chat HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n"));
      let text = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => (text += chunk));
      socket.on("end", () => resolve(text));
      socket.on("error", reject);
    });
    expect(raw.startsWith("HTTP/1.1 400") || raw.startsWith("HTTP/1.1 401")).toBe(true);
    // Сервер отвечает дальше.
    expect((await fetch(`${origin}/api/chat`, { headers: { "x-user": "anna" } })).status).toBeLessThan(500);
  });

  it("адрес строится без заголовка Host: база всегда localhost, Host уходит заголовком", async () => {
    let seen = "";
    const handler = {
      basePath: "/api/chat",
      fetch: async (request: Request) => {
        seen = request.url;
        return new Response(null, { status: 204 });
      },
    };
    const listener = toNodeListener(handler);
    const origin = await listen((req, res) => {
      req.url = "/api/chat/x";
      listener(req, res);
    });
    expect((await fetch(`${origin}/whatever`, { headers: { host: "evil.example" } })).status).toBe(204);
    expect(new URL(seen).host).toBe("localhost");
  });

  it("обратное давление: много ожиданий drain — слушатели не копятся (нет MaxListenersExceededWarning)", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(warning.name);
    process.on("warning", onWarning);
    try {
      const big = new Uint8Array(256 * 1024).fill(97);
      const handler = {
        basePath: "/api/chat",
        fetch: async () => {
          let sent = 0;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (sent++ < 20) controller.enqueue(big);
                else controller.close();
              },
            }),
          );
        },
      };
      const origin = await listen(toNodeListener(handler));
      const body = await (await fetch(`${origin}/api/chat/x`)).arrayBuffer();
      expect(body.byteLength).toBe(20 * big.length);
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnings).not.toContain("MaxListenersExceededWarning");
    } finally {
      process.off("warning", onWarning);
    }
  });

  it("разрыв соединения: ошибка обработчика после отмены не уходит в next", async () => {
    const next = vi.fn((_error?: unknown) => {});
    let aborted = false;
    const handler = {
      basePath: "/api/chat",
      fetch: (request: Request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("отменён"));
          });
        }),
    };
    const listener = toNodeListener(handler);
    const origin = await listen((req, res) => listener(req, res, next));
    const client = new AbortController();
    const pending = fetch(`${origin}/api/chat/x`, { signal: client.signal }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    client.abort();
    await pending;
    await expect.poll(() => aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(next).not.toHaveBeenCalled();
  });

  it("модуль не тянет express и hono", () => {
    const source = readFileSync(new URL("../src/node.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'](express|hono|next)(\/|["'])/);
  });
});
