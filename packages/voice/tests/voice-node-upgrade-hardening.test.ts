import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createVoiceUpgrade } from "../src/node";
import type { VoiceUpgradeOptions } from "../src/node";
import { createVoiceRelay } from "../src/server";
import type { VoiceRelayOptions } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function relayWith(options: Partial<VoiceRelayOptions> = {}) {
  FakeUpstream.instances = [];
  return createVoiceRelay({
    resolveUser: async () => ({ id: "anna" }),
    apiKey: "main-key",
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    logError: () => undefined,
    ...options,
  });
}

async function serve(options: Omit<VoiceUpgradeOptions, "path">, afterUpgrade?: (socket: Duplex) => void) {
  const upgrade = createVoiceUpgrade({ path: "/api/voice/stream", ...options });
  const server = createServer((_request, response) => response.end("next"));
  server.on("upgrade", (request, socket, head) => {
    if (!upgrade(request, socket, head)) return socket.destroy();
    afterUpgrade?.(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/** Сырой подъём WebSocket: путь любой, даже такой, который `new URL` не разбирает. Ответ сервера — до закрытия. */
function rawUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve) => {
    let answer = "";
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => (answer += chunk.toString()));
    socket.on("close", () => resolve(answer));
    socket.on("error", () => undefined);
  });
}

/** Ловит ошибки, которые никто не обработал: без них процесс приложения упал бы. */
function watchUncaught() {
  const caught: unknown[] = [];
  const listener = (error: unknown) => caught.push(error);
  process.prependListener("uncaughtException", listener);
  return { caught, stop: () => process.off("uncaughtException", listener) };
}

describe("node-вход голоса: сеть не роняет процесс", () => {
  it("путь `//` (new URL его не разбирает) — ответ 400, процесс жив", async () => {
    const uncaught = watchUncaught();
    const port = await serve({ relay: relayWith() });

    const answer = await rawUpgrade(port, "//");
    uncaught.stop();

    expect(answer.startsWith("HTTP/1.1 400")).toBe(true);
    expect(uncaught.caught).toEqual([]);
  });

  it("обрыв сети, пока идёт проверка входа: ошибка сокета поймана, соединение не поднимается", async () => {
    let socketGone!: () => void;
    const gone = new Promise<void>((resolve) => (socketGone = resolve));
    let accepted = 0;
    const relay = relayWith({
      resolveUser: async () => {
        await gone;
        return { id: "anna" };
      },
    });
    const accept = relay.accept.bind(relay);
    relay.accept = (...args) => {
      accepted += 1;
      return accept(...args);
    };
    const uncaught = watchUncaught();
    const port = await serve({ relay }, (socket) =>
      // Как ECONNRESET от ядра: сокет уничтожен с ошибкой, пока ждём `authorize`.
      setImmediate(() => {
        socket.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
        setTimeout(socketGone, 20);
      }),
    );

    await rawUpgrade(port, "/api/voice/stream");
    await new Promise((resolve) => setTimeout(resolve, 60));
    uncaught.stop();

    expect(uncaught.caught).toEqual([]);
    expect(accepted).toBe(0);
  });

  it("проверка входа зависла — 503 после срока, сокет закрыт", async () => {
    const port = await serve({ relay: relayWith({ resolveUser: () => new Promise(() => undefined) }), authorizeTimeoutMs: 50 });
    const answer = await rawUpgrade(port, "/api/voice/stream");
    expect(answer.startsWith("HTTP/1.1 503")).toBe(true);
  });
});
