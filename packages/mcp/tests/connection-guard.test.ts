import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinnedFetch, guardedFetch } from "../src/connection/guarded-fetch";
import { createMcpServers, createMemoryMcpStore } from "../src/index";
import { publicResolver } from "./support/fake-mcp-server";
import { SECRET_KEY, setupMcp } from "./support/setup";

const PROXY_TOKEN = "proxy-SECRET-55";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** Настоящий HTTP-сервер на 127.0.0.1: считает запросы и отвечает телом `body`. */
async function localServer(body = "ok", headers: Record<string, string> = { "content-type": "text/plain" }) {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(request.url ?? "");
    response.writeHead(200, headers);
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { port: (server.address() as AddressInfo).port, hits };
}

describe("заголовки прокси — только на адрес прокси", () => {
  it("сервер не на хосте прокси — токена прокси он не видит", async () => {
    const setup = await setupMcp({}, { proxy: { origin: "https://proxy.example.net", headers: { "X-Proxy-Token": PROXY_TOKEN } } });
    await setup.mcp.admin.addServer({ name: "Wiki", prefix: "wiki", url: "https://mcp.example.com/mcp", viaProxy: true, status: "everyone" });
    expect(setup.fake.requests.length).toBeGreaterThan(0);
    expect(setup.fake.requests.every((request) => request.headers["x-proxy-token"] === undefined)).toBe(true);
  });

  it("сервер на хосте прокси — токен уходит", async () => {
    const setup = await setupMcp({}, { proxy: { origin: "https://mcp.example.com", headers: { "X-Proxy-Token": PROXY_TOKEN } } });
    await setup.mcp.admin.addServer({ name: "Wiki", prefix: "wiki", url: "https://mcp.example.com/mcp", viaProxy: true, status: "everyone" });
    expect(setup.fake.requests.every((request) => request.headers["x-proxy-token"] === PROXY_TOKEN)).toBe(true);
  });

  it("заголовки прокси без адреса прокси — ошибка настройки при запуске", async () => {
    await expect(
      createMcpServers({ store: createMemoryMcpStore(), secretKey: SECRET_KEY, isAdmin: () => true, proxy: { headers: { "X-Proxy-Token": PROXY_TOKEN } }, syncIntervalMs: 0 }),
    ).rejects.toThrow(/proxy\.origin/);
  });
});

describe("адрес закреплён: проверка и соединение по одному ответу DNS", () => {
  it("соединение идёт на адрес, который вернула проверка; DNS спрашивается один раз", async () => {
    const { port, hits } = await localServer();
    const resolveHost = vi.fn(async () => ["127.0.0.1"]);
    const pinned = createPinnedFetch({ resolveHost, allowPrivateNetwork: true });
    closers.push(pinned.close);
    const fetch = guardedFetch({ fetch: pinned.fetch, pinned: true, resolveHost, allowPrivateNetwork: true, maxResponseBytes: 1024 });
    // Имени `pinned.test` системный DNS не знает: дошли — значит, соединение шло на проверенный адрес.
    const response = await fetch(`http://pinned.test:${port}/mcp`);
    expect(await response.text()).toBe("ok");
    expect(hits).toEqual(["/mcp"]);
    expect(resolveHost).toHaveBeenCalledTimes(1);
  });

  it("DNS отдал частный адрес в момент соединения — отказ, до сервера запрос не дошёл", async () => {
    const { port, hits } = await localServer();
    const resolveHost = vi.fn(async () => ["127.0.0.1"]);
    const pinned = createPinnedFetch({ resolveHost, allowPrivateNetwork: false });
    closers.push(pinned.close);
    const fetch = guardedFetch({ fetch: pinned.fetch, pinned: true, resolveHost, allowPrivateNetwork: false, maxResponseBytes: 1024 });
    await expect(fetch(`http://rebind.example.com:${port}/mcp`)).rejects.toMatchObject({ kind: "bad_address" });
    expect(hits).toEqual([]);
  });

  it("свой fetch (прокси приложения, тесты) — проверка DNS перед запросом, как раньше", async () => {
    const own = vi.fn(async () => new Response("ok"));
    const fetch = guardedFetch({ fetch: own, resolveHost: async () => ["10.0.0.7"], allowPrivateNetwork: false, maxResponseBytes: 1024 });
    await expect(fetch("https://evil.example.com/mcp")).rejects.toMatchObject({ kind: "bad_address" });
    expect(own).not.toHaveBeenCalled();
  });
});

describe("предел тела — на одно сообщение", () => {
  const sse = (...events: string[]) => events.map((data) => `event: message\ndata: ${data}\n\n`).join("");
  const read = (body: string, contentType: string) =>
    guardedFetch({ fetch: async () => new Response(body, { headers: { "content-type": contentType } }), resolveHost: publicResolver, allowPrivateNetwork: false, maxResponseBytes: 1000 })(
      "https://mcp.example.com/mcp",
    ).then((response) => response.text());

  it("поток SSE: много сообщений вместе больше предела — читается целиком", async () => {
    const body = sse("a".repeat(600), "b".repeat(600), "c".repeat(600));
    expect(await read(body, "text/event-stream")).toBe(body);
  });

  it("поток SSE: одно сообщение больше предела — обрыв", async () => {
    await expect(read(sse("a".repeat(1500)), "text/event-stream")).rejects.toMatchObject({ kind: "too_large" });
  });

  it("обычный ответ — предел на всё тело", async () => {
    await expect(read("x".repeat(1500), "application/json")).rejects.toMatchObject({ kind: "too_large" });
  });
});
