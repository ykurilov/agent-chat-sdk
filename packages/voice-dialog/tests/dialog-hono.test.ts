import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { Hono } from "hono";
import type { UpgradeWebSocket, WSEvents } from "hono/ws";
import { describe, expect, it } from "vitest";
import { mountDialogRelay } from "../src/hono";
import type { MountDialogRelayOptions } from "../src/hono";
import { FakeSocket, connectFake } from "./support/fake-socket";
import { ELEVEN_KEY, SONIOX_KEY, START } from "./support/session-harness";

const flush = async () => {
  for (let step = 0; step < 30; step += 1) await Promise.resolve();
};

/** Подмена подъёма WebSocket: отдаёт тесту обработчики событий, которые повесило приложение. */
function fakeUpgrade() {
  const captured: { events?: WSEvents } = {};
  const upgradeWebSocket: UpgradeWebSocket = ((factory: (context: never) => WSEvents) => async (context: { text: (text: string) => Response; req: unknown }) => {
    captured.events = factory(context as never);
    return context.text("upgraded");
  }) as never;
  return { upgradeWebSocket, captured };
}

async function mounted(extra: Partial<MountDialogRelayOptions> = {}) {
  FakeSocket.instances = [];
  const storage = createInMemoryChatStorage();
  await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
  const { upgradeWebSocket, captured } = fakeUpgrade();
  const app = new Hono();
  mountDialogRelay(app, {
    path: "/api/voice-dialog",
    upgradeWebSocket,
    storage,
    resolveUser: async (request) => (request.headers.get("cookie") === "session=anna" ? { id: "anna" } : null),
    speech: {
      voices: [
        { id: "voice-1", name: "Диктор" },
        { id: "voice-2", name: "Рассказчик" },
      ],
      defaultVoiceId: "voice-1",
      pricePerThousandChars: { eleven_v4_turbo: 0.05 },
      apiKey: ELEVEN_KEY,
      connect: connectFake,
    },
    recognition: { apiKey: SONIOX_KEY, connectUpstream: connectFake },
    logError: () => {},
    ...extra,
  });
  const sent: Array<string | Uint8Array> = [];
  const closed: number[] = [];
  const socket = { send: (data: string | Uint8Array) => sent.push(data), close: (code?: number) => closed.push(code ?? 1000) };
  const connect = async (chatId = "chat-1", cookie = "session=anna") => {
    const response = await app.request(`/api/voice-dialog/stream?chatId=${chatId}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    captured.events!.onOpen?.(new Event("open"), socket as never);
    await flush();
  };
  const receive = async (data: unknown) => {
    captured.events!.onMessage?.({ data } as MessageEvent, socket as never);
    await flush();
  };
  return { app, captured, sent, closed, connect, receive };
}

describe("подключение диалога к Hono", () => {
  it("WebSocket поднимается на {path}/stream; допуск решается по запросу подъёма (куки)", async () => {
    const { connect, receive, sent } = await mounted();
    await connect();
    await receive(JSON.stringify(START));
    FakeSocket.instances[0]!.open();
    await flush();
    expect(JSON.parse(sent[0] as string)).toMatchObject({ type: "ready", speech: true });
  });

  it("нет пользователя — соединение закрывается кодом 4401", async () => {
    const { connect, closed } = await mounted();
    await connect("chat-1", "");
    expect(closed).toEqual([4401]);
  });

  it("звук приходит и как Blob, и как ArrayBuffer; порядок сохраняется", async () => {
    const { connect, receive } = await mounted();
    await connect();
    await receive(JSON.stringify(START));
    FakeSocket.instances[0]!.open();
    await flush();
    await receive(new Blob([new Uint8Array([1, 2])]));
    await receive(new Uint8Array([3]).buffer);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(FakeSocket.instances[0]!.audio.map((chunk) => [...chunk])).toEqual([[1, 2], [3]]);
  });

  it("закрытие браузером закрывает Soniox", async () => {
    const { connect, receive, captured } = await mounted();
    await connect();
    await receive(JSON.stringify(START));
    captured.events!.onClose?.(new Event("close") as never, {} as never);
    expect(FakeSocket.instances[0]!.closed).toBe(true);
  });
});

describe("HTTP голосов на том же пути", () => {
  const cookie = { cookie: "session=anna" };

  it("GET {path}/voices и PUT {path}/voice подключены вместе с WebSocket и делят выбор с режимом", async () => {
    const { app, connect, receive, sent } = await mounted();
    const before = await app.request("/api/voice-dialog/voices", { headers: cookie });
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ voices: [{ id: "voice-1", name: "Диктор" }, { id: "voice-2", name: "Рассказчик" }], current: "voice-1" });
    const put = await app.request("/api/voice-dialog/voice", {
      method: "PUT",
      headers: { ...cookie, "content-type": "application/json" },
      body: JSON.stringify({ voiceId: "voice-2" }),
    });
    expect(put.status).toBe(204);
    expect(await (await app.request("/api/voice-dialog/voices", { headers: cookie })).json()).toMatchObject({ current: "voice-2" });
    await connect();
    await receive(JSON.stringify(START));
    FakeSocket.instances[0]!.open();
    await flush();
    expect(JSON.parse(sent[0] as string)).toMatchObject({ type: "ready", voiceId: "voice-2" });
  });

  it("без пользователя — 401", async () => {
    const { app } = await mounted();
    expect((await app.request("/api/voice-dialog/voices")).status).toBe(401);
  });
});

describe("проверка Origin при подъёме WebSocket", () => {
  const upgrade = (app: Hono, headers: Record<string, string>, url = "http://localhost/api/voice-dialog/stream?chatId=chat-1") =>
    app.request(url, { headers: { cookie: "session=anna", ...headers } });

  it("без allowedOrigins чужая страница не поднимает сокет: 403, обработчики не создаются", async () => {
    const { app, captured } = await mounted();
    expect((await upgrade(app, { origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await upgrade(app, { origin: "https://evil.example", host: "localhost:5931" })).status).toBe(403);
    expect(captured.events).toBeUndefined();
  });

  it("без allowedOrigins своя страница поднимает сокет: Sec-Fetch-Site same-origin или Origin совпадает с Host", async () => {
    const { app, captured } = await mounted();
    expect((await upgrade(app, { origin: "http://localhost:5931", "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await upgrade(app, { origin: "http://localhost:5931", host: "localhost:5931" })).status).toBe(200);
    expect(captured.events).toBeDefined();
  });

  it("выбор голоса (PUT) с чужой страницы — 403; чтение списка голосов (GET) не проверяется", async () => {
    const { app } = await mounted();
    const cross = { cookie: "session=anna", origin: "https://evil.example", "sec-fetch-site": "cross-site" };
    const put = await app.request("/api/voice-dialog/voice", { method: "PUT", headers: { ...cross, "content-type": "application/json" }, body: JSON.stringify({ voiceId: "voice-2" }) });
    expect(put.status).toBe(403);
    expect(await put.json()).toEqual({ error: { kind: "forbidden_origin" } });
    expect((await app.request("/api/voice-dialog/voices", { headers: cross })).status).toBe(200);
  });

  it("Origin из списка — подъём; чужой — 403 и обработчики сокета не создаются", async () => {
    const allowed = await mounted({ allowedOrigins: ["https://app.example"] });
    expect((await upgrade(allowed.app, { origin: "https://app.example" })).status).toBe(200);
    expect(allowed.captured.events).toBeDefined();

    const foreign = await mounted({ allowedOrigins: ["https://app.example"] });
    expect((await upgrade(foreign.app, { origin: "https://evil.example" })).status).toBe(403);
    expect(foreign.captured.events).toBeUndefined();
  });

  it("запрос без Origin (не браузер) проходит: защита от чужих страниц, а вход проверяет resolveUser", async () => {
    const { app, captured } = await mounted({ allowedOrigins: ["https://app.example"] });
    expect((await upgrade(app, {})).status).toBe(200);
    expect(captured.events).toBeDefined();
  });

  it("Origin: null (песочница, файл) не проходит", async () => {
    const { app } = await mounted({ allowedOrigins: ["https://app.example"] });
    expect((await upgrade(app, { origin: "null" })).status).toBe(403);
  });

  it("порт обязателен: localhost:5931 — не то же самое, что localhost; адрес запроса (в нём порта нет) не сравнивается", async () => {
    const { app } = await mounted({ allowedOrigins: ["http://localhost:5931"] });
    // Так `@hono/node-ws` собирает адрес при подъёме: порт потерян, настоящий адрес — в заголовке Host.
    expect((await upgrade(app, { origin: "http://localhost:5931", host: "localhost:5931" }, "http://localhost/api/voice-dialog/stream?chatId=chat-1")).status).toBe(200);
    expect((await upgrade(app, { origin: "http://localhost", host: "localhost:5931" })).status).toBe(403);
    expect((await upgrade(app, { origin: "http://localhost:5932", host: "localhost:5931" })).status).toBe(403);
  });

  it("запись в списке сравнивается как адрес: регистр, косая черта в конце, порт по умолчанию", async () => {
    const { app } = await mounted({ allowedOrigins: ["HTTPS://App.Example:443/", "http://localhost:5931/"] });
    expect((await upgrade(app, { origin: "https://app.example" })).status).toBe(200);
    expect((await upgrade(app, { origin: "http://localhost:5931" })).status).toBe(200);
  });

  it("пустой список — подъём закрыт для любой страницы", async () => {
    const { app } = await mounted({ allowedOrigins: [] });
    expect((await upgrade(app, { origin: "https://app.example" })).status).toBe(403);
  });

  it("запись списка не адрес — сервер не стартует, с понятным сообщением", async () => {
    await expect(mounted({ allowedOrigins: ["app.example"] })).rejects.toThrow(/allowedOrigins/);
  });
});
