import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createVoiceUpgrade, sharedVoiceRelay, shareVoiceRelay } from "../src/node";
import { createVoiceRelay } from "../src/server";
import type { VoiceRelay, VoiceRelayOptions } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  shareVoiceRelay(null);
});

function relayWith(options: Partial<VoiceRelayOptions> = {}) {
  FakeUpstream.instances = [];
  return createVoiceRelay({
    resolveUser: async (request) => (request.headers.get("cookie") === "session=anna" ? { id: "anna" } : null),
    apiKey: "main-key",
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    logError: () => undefined,
    ...options,
  });
}

/** Сервер как у Next.js с custom server: голос — наш, остальные подъёмы — «Next.js». */
async function serve(relay: VoiceRelay | (() => VoiceRelay | null), maxFrameBytes?: number) {
  const others: string[] = [];
  const upgrade = createVoiceUpgrade({ path: "/api/voice/stream", relay, ...(maxFrameBytes && { maxFrameBytes }) });
  const server = createServer((_request, response) => response.end("next"));
  server.on("upgrade", (request, socket, head) => {
    if (!upgrade(request, socket, head)) {
      others.push(request.url ?? "");
      socket.destroy();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { port, others };
}

type Outcome = { opened: boolean; closeCode?: number; httpStatus?: number; messages: string[] };

function open(port: number, path: string, headers: Record<string, string> = {}, onOpen?: (socket: WebSocket) => void): Promise<Outcome> {
  return new Promise((resolve) => {
    const outcome: Outcome = { opened: false, messages: [] };
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    socket.on("open", () => {
      outcome.opened = true;
      onOpen?.(socket);
    });
    socket.on("message", (data) => outcome.messages.push(data.toString()));
    socket.on("unexpected-response", (_request, response) => {
      outcome.httpStatus = response.statusCode;
      resolve(outcome);
    });
    socket.on("close", (code) => resolve({ ...outcome, closeCode: code }));
    socket.on("error", () => undefined);
  });
}

describe("голос в Next.js: подъём WebSocket на своём HTTP-сервере (custom server)", () => {
  it("вошедший со своей страницы: приветствие уходит в Soniox, «готово» приходит обратно", async () => {
    const { port } = await serve(relayWith());
    const done = open(port, "/api/voice/stream?chat=c1", { cookie: "session=anna", origin: `http://127.0.0.1:${port}` }, (socket) => {
      socket.send(JSON.stringify({ audio_format: "auto" }));
      const timer = setInterval(() => {
        const upstream = FakeUpstream.instances.at(-1);
        if (!upstream) return;
        clearInterval(timer);
        upstream.open();
        setTimeout(() => socket.close(1000), 20);
      }, 5);
    });
    const outcome = await done;

    expect(outcome.opened).toBe(true);
    expect(JSON.parse(outcome.messages[0]!)).toMatchObject({ ready: true });
    expect(FakeUpstream.instances.at(-1)!.messages[0]).toMatchObject({ audio_format: "auto" });
  });

  it("не вошёл — соединение открывается и сразу закрывается с кодом «нет доступа»: браузер видит причину", async () => {
    const { port } = await serve(relayWith());
    expect(await open(port, "/api/voice/stream")).toMatchObject({ opened: true, closeCode: 4401 });
  });

  it("чужая страница — обычный HTTP-отказ 403, соединения нет", async () => {
    const { port } = await serve(relayWith());
    const outcome = await open(port, "/api/voice/stream", { cookie: "session=anna", origin: "https://evil.test", "sec-fetch-site": "cross-site" });
    expect(outcome).toMatchObject({ opened: false, httpStatus: 403 });
  });

  it("другой адрес — не наш: подъём уходит дальше (Next.js)", async () => {
    const { port, others } = await serve(relayWith());
    await open(port, "/_next/webpack-hmr");
    expect(others).toEqual(["/_next/webpack-hmr"]);
  });

  it("ретранслятора ещё нет (Next.js не поднялся или нет ключа) — 503", async () => {
    const { port } = await serve(() => null);
    expect(await open(port, "/api/voice/stream")).toMatchObject({ opened: false, httpStatus: 503 });
  });

  it("кусок больше предела — закрытие 1009 («слишком длинно»)", async () => {
    const { port } = await serve(relayWith(), 1024);
    const outcome = await open(port, "/api/voice/stream", { cookie: "session=anna" }, (socket) => socket.send(Buffer.alloc(4096)));
    expect(outcome.closeCode).toBe(1009);
  });

  it("мостик процесса: ретранслятор, созданный в коде Next.js, виден серверу", async () => {
    const relay = relayWith();
    shareVoiceRelay(relay);
    expect(sharedVoiceRelay()).toBe(relay);
    const { port } = await serve(sharedVoiceRelay);
    expect(await open(port, "/api/voice/stream")).toMatchObject({ closeCode: 4401 });
  });

  /**
   * Как Next.js: свой обработчик upgrade он вешает сам и закрывает сокет, если адрес совпал с маршрутом
   * (`app/[...slug]` совпадает с любым). Рецепт README держит его на отдельном сервере.
   */
  async function serveWithFramework(frameworkOnSameServer: boolean) {
    const framework = createServer();
    const frameworkSaw: string[] = [];
    const closesEverything = (request: IncomingMessage, socket: Duplex) => {
      frameworkSaw.push(request.url ?? "");
      setTimeout(() => socket.end(), 30);
    };
    const upgrade = createVoiceUpgrade({ path: "/api/voice/stream", relay: relayWith() });
    const server = createServer((_request, response) => response.end("next"));
    server.on("upgrade", (request, socket, head) => {
      if (!upgrade(request, socket, head)) framework.emit("upgrade", request, socket, head);
    });
    (frameworkOnSameServer ? server : framework).on("upgrade", closesEverything);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { port: (server.address() as AddressInfo).port, frameworkSaw };
  }

  /** Диктовка до «готово» и ещё немного: дольше, чем ждёт «фреймворк» перед закрытием. */
  function dictate(port: number) {
    return open(port, "/api/voice/stream", { cookie: "session=anna" }, (socket) => {
      socket.send(JSON.stringify({ audio_format: "auto" }));
      const timer = setInterval(() => {
        const upstream = FakeUpstream.instances.at(-1);
        if (!upstream) return;
        clearInterval(timer);
        upstream.open();
        setTimeout(() => socket.close(1000), 150);
      }, 5);
    });
  }

  it("Next.js на отдельном сервере (рецепт README): голос он не видит, свои соединения получает", async () => {
    const { port, frameworkSaw } = await serveWithFramework(false);
    const outcome = await dictate(port);
    await open(port, "/_next/hmr");

    expect(outcome).toMatchObject({ opened: true, closeCode: 1000 });
    expect(JSON.parse(outcome.messages[0]!)).toMatchObject({ ready: true });
    expect(frameworkSaw).toEqual(["/_next/hmr"]);
  });

  it("Next.js на том же сервере обрывает голос — поэтому рецепт выносит его отдельно", async () => {
    const { port } = await serveWithFramework(true);
    expect((await dictate(port)).closeCode).toBe(1006);
  });
});
