import { SpendingLimitReachedError, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { SpendingLimits } from "@ykurilov/agent-chat-core";
import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { describe, expect, it } from "vitest";
import { mountDialogRelay } from "../src/hono";
import type { MountDialogRelayOptions } from "../src/hono";
import type { FillerManifest } from "../src/protocol";
import { FakeSocket, base64Pcm, connectFake } from "./support/fake-socket";
import { ELEVEN_KEY, SONIOX_KEY } from "./support/session-harness";

const flush = async () => {
  for (let step = 0; step < 30; step += 1) await Promise.resolve();
};

const upgradeWebSocket = (() => async () => new Response("upgraded")) as unknown as UpgradeWebSocket;
const anna = { headers: { cookie: "session=anna" } };

async function mounted(extra: Partial<MountDialogRelayOptions> = {}, withSpeech = true) {
  FakeSocket.instances = [];
  const storage = createInMemoryChatStorage();
  await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
  await storage.createChat({ id: "chat-boris", ownerId: "boris", modelId: "m", providerId: "p" });
  const app = new Hono();
  mountDialogRelay(app, {
    path: "/api/voice-dialog",
    upgradeWebSocket,
    storage,
    resolveUser: async (request) => (request.headers.get("cookie") === "session=anna" ? { id: "anna" } : null),
    ...(withSpeech && {
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
    }),
    recognition: { apiKey: SONIOX_KEY, connectUpstream: connectFake },
    logError: () => {},
    ...extra,
  });
  const manifest = async () => ((await (await app.request("/api/voice-dialog/fillers", anna)).json()) as FillerManifest).phrases;
  return { app, storage, manifest };
}

describe("маршруты заполнителей", () => {
  it("GET /fillers: список фраз только вошедшему человеку", async () => {
    const { app, manifest } = await mounted();

    expect((await app.request("/api/voice-dialog/fillers")).status).toBe(401);
    const response = await app.request("/api/voice-dialog/fillers", anna);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const phrases = await manifest();
    expect(phrases.length).toBeGreaterThan(5);
    expect(phrases[0]).toEqual({ id: expect.any(String), category: "thinking", text: expect.any(String) });
  });

  it("GET /fillers/{id}: звук выбранного голоса — PCM как есть, из первого синтеза, дальше из кэша", async () => {
    const { app, manifest } = await mounted();
    const [phrase] = await manifest();

    const pending = app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=voice-2&chatId=chat-1`, anna);
    await flush();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    expect(JSON.stringify(socket.messages)).toContain('"voice_id":"voice-2"');
    socket.receive({ audio: base64Pcm(2400, 5) });
    socket.receive({ is_final: true });
    const response = await pending;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(2400);
    expect(body[0]).toBe(5);

    const again = await app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=voice-2&chatId=chat-1`, anna);
    expect(again.status).toBe(200);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("без входа — 401, и до ElevenLabs дело не доходит", async () => {
    const { app, manifest } = await mounted();
    const [phrase] = await manifest();

    const response = await app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=voice-1&chatId=chat-1`);

    expect(response.status).toBe(401);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("приложение отказало словами: и список, и фраза отвечают access_refused без кэша, до ElevenLabs не доходит", async () => {
    const { app } = await mounted({ resolveUser: async () => ({ refused: { code: "no_course", message: "Нужен доступ к курсу", status: 401 as const } }) });
    const expected = { error: { kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" } };

    const list = await app.request("/api/voice-dialog/fillers");
    expect(list.status).toBe(401);
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(await list.json()).toEqual(expected);

    const phrase = await app.request("/api/voice-dialog/fillers/any?voiceId=voice-1&chatId=chat-1");
    expect(phrase.status).toBe(401);
    expect(await phrase.json()).toEqual(expected);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("голос не из списка или нет чата в запросе — 400", async () => {
    const { app, manifest } = await mounted();
    const [phrase] = await manifest();

    expect((await app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=чужой&chatId=chat-1`, anna)).status).toBe(400);
    expect((await app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=voice-1`, anna)).status).toBe(400);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("чужой или несуществующий чат — 403: расход не записывается на чужой чат", async () => {
    const { app, manifest } = await mounted();
    const [phrase] = await manifest();

    expect((await app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=voice-1&chatId=chat-boris`, anna)).status).toBe(403);
    expect((await app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=voice-1&chatId=нет`, anna)).status).toBe(403);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("неизвестная фраза — 404", async () => {
    const { app } = await mounted();

    expect((await app.request("/api/voice-dialog/fillers/нет-такой?voiceId=voice-1&chatId=chat-1", anna)).status).toBe(404);
  });

  it("лимит расходов исчерпан — 402 «limit»", async () => {
    const exhausted: SpendingLimits = {
      assertWithinLimit: async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
      status: async () => ({ state: "exhausted" }),
    };
    const { app, manifest } = await mounted({ spendingLimits: exhausted });
    const [phrase] = await manifest();

    const response = await app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=voice-1&chatId=chat-1`, anna);

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "limit" });
  });

  it("ElevenLabs не ответил — 503", async () => {
    const { app, manifest } = await mounted();
    const [phrase] = await manifest();

    const pending = app.request(`/api/voice-dialog/fillers/${phrase!.id}?voiceId=voice-1&chatId=chat-1`, anna);
    await flush();
    FakeSocket.instances[0]!.fail();

    const response = await pending;
    expect(response.status).toBe(503);
  });

  it("свои фразы из настроек попадают в список", async () => {
    const { manifest } = await mounted({ speech: { voices: [{ id: "voice-1", name: "Диктор" }], defaultVoiceId: "voice-1", pricePerThousandChars: { eleven_v4_turbo: 0.05 }, apiKey: ELEVEN_KEY, connect: connectFake, fillerPhrases: { web: ["Ищу."] } } });

    expect((await manifest()).filter((phrase) => phrase.category === "web").map((phrase) => phrase.text)).toEqual(["Ищу."]);
  });

  it("fillerPhrases: false или озвучки нет — маршрутов нет", async () => {
    const off = await mounted({ speech: { voices: [{ id: "voice-1", name: "Диктор" }], defaultVoiceId: "voice-1", pricePerThousandChars: { eleven_v4_turbo: 0.05 }, apiKey: ELEVEN_KEY, connect: connectFake, fillerPhrases: false } });
    const noSpeech = await mounted({}, false);

    expect((await off.app.request("/api/voice-dialog/fillers", anna)).status).toBe(404);
    expect((await noSpeech.app.request("/api/voice-dialog/fillers", anna)).status).toBe(404);
    // сами голоса при этом работают
    expect((await off.app.request("/api/voice-dialog/voices", anna)).status).toBe(200);
  });
});
