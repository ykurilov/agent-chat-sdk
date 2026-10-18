import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { mountVoiceRelay } from "../src/hono";
import { createVoiceRelay } from "../src/server";
import type { VoiceRelayOptions } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

const servers: Array<ReturnType<typeof serve>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function honoWith(options: Partial<VoiceRelayOptions>) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  const relay = createVoiceRelay({
    resolveUser: async () => ({ id: "anna" }),
    apiKey: "main-key",
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    logError: () => undefined,
    ...options,
  });
  mountVoiceRelay(app, "/api/voice/stream", relay, upgradeWebSocket);
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  injectWebSocket(server);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  return (server.address() as AddressInfo).port;
}

function outcome(port: number, headers: Record<string, string> = {}, onOpen?: (socket: WebSocket) => void) {
  return new Promise<{ opened: boolean; closeCode?: number; httpStatus?: number }>((resolve) => {
    let opened = false;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/voice/stream`, { headers });
    socket.on("open", () => {
      opened = true;
      onOpen?.(socket);
    });
    socket.on("unexpected-response", (_request, response) => resolve({ opened, httpStatus: response.statusCode }));
    socket.on("close", (code) => resolve({ opened, closeCode: code }));
    socket.on("error", () => undefined);
  });
}

describe("Hono: причина отказа доходит до браузера кодом закрытия", () => {
  it("отказ приложения «лимит» — соединение открыто и закрыто кодом 4402", async () => {
    const port = await honoWith({ resolveUser: async () => ({ refused: { code: "limit", message: "лимит" } }) });
    expect(await outcome(port)).toEqual({ opened: true, closeCode: 4402 });
  });

  it("не вошёл — 4401", async () => {
    const port = await honoWith({ resolveUser: async () => null });
    expect(await outcome(port)).toEqual({ opened: true, closeCode: 4401 });
  });

  it("обычный HTTP-запрос без подъёма WebSocket — сам отказ (401), а не «не найдено»", async () => {
    const port = await honoWith({ resolveUser: async () => null });
    expect((await fetch(`http://127.0.0.1:${port}/api/voice/stream`)).status).toBe(401);
  });

  it("чужая страница — HTTP 403 без соединения", async () => {
    const port = await honoWith({});
    expect(await outcome(port, { origin: "https://evil.test", "sec-fetch-site": "cross-site" })).toEqual({ opened: false, httpStatus: 403 });
  });
});

describe("Hono: предел одного куска — тот же, что у node-входа", () => {
  it("кусок больше `maxFrameBytes` — закрытие 1009", async () => {
    const port = await honoWith({ maxFrameBytes: 1024 });
    expect(await outcome(port, {}, (socket) => socket.send(Buffer.alloc(4096)))).toEqual({ opened: true, closeCode: 1009 });
  });
});
