import { SpendingLimitReachedError, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeSpeechFrame } from "../src/protocol";
import type { ServerMessage } from "../src/protocol";
import { createDialogRelay } from "../src/server/dialog-relay";
import { createVoiceCatalog } from "../src/server/voices";
import type { DialogRelayOptions } from "../src/server/dialog-relay";
import { FakeSocket, connectFake, speechChunk } from "./support/fake-socket";
import { ELEVEN_KEY, SONIOX_KEY, START, listenFor, scribeFake, scribeSounds, sonioxWords } from "./support/session-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

class FakeClient {
  readonly sent: Array<string | Uint8Array> = [];
  closedWith: number | undefined;
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close(code: number) {
    this.closedWith ??= code;
  }
  get messages() {
    return this.sent.filter((item): item is string => typeof item === "string").map((text) => JSON.parse(text) as ServerMessage);
  }
  get frames() {
    return this.sent.filter((item): item is Uint8Array => typeof item !== "string").map((frame) => decodeSpeechFrame(frame)!);
  }
}

const exhausted: SpendingLimits = {
  assertWithinLimit: async () => {
    throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
  },
  status: async () => ({ state: "exhausted" }),
};

/** Даёт закончиться цепочке обещаний (допуск, очередь сообщений). */
const flush = async () => {
  for (let step = 0; step < 30; step += 1) await Promise.resolve();
};

async function relayWith(overrides: Partial<DialogRelayOptions> = {}, setupStorage?: (storage: ChatStorage) => Promise<void>) {
  FakeSocket.instances = [];
  const storage = createInMemoryChatStorage();
  await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
  await storage.createChat({ id: "chat-2", ownerId: "boris", modelId: "m", providerId: "p" });
  await setupStorage?.(storage);
  const logged: string[] = [];
  const relay = createDialogRelay({
    storage,
    resolveUser: async (request) => {
      const id = request.headers.get("x-user");
      return id ? { id } : null;
    },
    speech: {
      voices: [
        { id: "voice-1", name: "Диктор" },
        { id: "voice-2", name: "Рассказчик" },
      ],
      defaultVoiceId: "voice-1",
      pricePerThousandChars: { eleven_v4_turbo: 0.05, eleven_v4: 0.1 },
      apiKey: ELEVEN_KEY,
      connect: connectFake,
    },
    recognition: { apiKey: SONIOX_KEY, connectUpstream: connectFake },
    logError: (message) => logged.push(message),
    ...overrides,
  });
  const connect = async (options: { user?: string | null; chatId?: string | null } = {}) => {
    const user = options.user === undefined ? "anna" : options.user;
    const chatId = options.chatId === undefined ? "chat-1" : options.chatId;
    const request = new Request(`http://app.test/api/voice-dialog/stream${chatId ? `?chatId=${chatId}` : ""}`, {
      headers: user ? { "x-user": user } : {},
    });
    const client = new FakeClient();
    const connection = relay.accept(client, request);
    await flush();
    return { client, connection };
  };
  /** Соединение принято, `start` отправлен, Soniox «ответил»: режим готов. */
  const ready = async (options: Parameters<typeof connect>[0] = {}) => {
    const setup = await connect(options);
    setup.connection.receive(JSON.stringify(START));
    await flush();
    FakeSocket.instances[0]?.open();
    await flush();
    return setup;
  };
  return { relay, storage, logged, connect, ready };
}

describe("ретранслятор диалога: допуск при соединении", () => {
  it("нет пользователя — 4401", async () => {
    const { connect } = await relayWith();
    expect((await connect({ user: null })).client.closedWith).toBe(4401);
  });

  it("чужой чат — 4403; неизвестный чат и отсутствие chatId — тоже", async () => {
    const { connect } = await relayWith();
    expect((await connect({ chatId: "chat-2" })).client.closedWith).toBe(4403);
    expect((await connect({ chatId: "нет-такого" })).client.closedWith).toBe(4403);
    expect((await connect({ chatId: null })).client.closedWith).toBe(4403);
  });

  it("порядок проверок: без пользователя чужой чат не выдаётся, а ключи и Soniox не трогаются", async () => {
    const { connect } = await relayWith();
    await connect({ user: null, chatId: "chat-2" });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("слишком частые включения — 4429; окно проходит — снова можно", async () => {
    const { connect } = await relayWith({ rateLimit: { maxSessions: 2, perSeconds: 60 }, maxConnectionsPerUser: false });
    expect((await connect()).client.closedWith).toBeUndefined();
    expect((await connect()).client.closedWith).toBeUndefined();
    expect((await connect()).client.closedWith).toBe(4429);
    vi.advanceTimersByTime(61_000);
    expect((await connect()).client.closedWith).toBeUndefined();
  });

  it("слишком много одновременных соединений — 4429; место освобождается закрытием", async () => {
    const { connect } = await relayWith({ maxConnectionsPerUser: 1, rateLimit: false });
    const first = await connect();
    expect((await connect()).client.closedWith).toBe(4429);
    first.connection.closed();
    expect((await connect()).client.closedWith).toBeUndefined();
  });

  it("по умолчанию два соединения на человека", async () => {
    const { connect } = await relayWith({ rateLimit: false });
    await connect();
    await connect();
    expect((await connect()).client.closedWith).toBe(4429);
    expect((await connect({ user: "boris", chatId: "chat-2" })).client.closedWith).toBeUndefined();
  });

  it("resolveUser отказал словами приложения — закрытие как при отказе входа (4401), к речи не идёт", async () => {
    const { connect } = await relayWith({ resolveUser: async () => ({ refused: { code: "no_course", message: "Нужен доступ к курсу", status: 401 as const } }) });
    const { client } = await connect();
    expect(client.closedWith).toBe(4401);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("лимит расходов исчерпан — 4402", async () => {
    const { connect } = await relayWith({ spendingLimits: exhausted });
    expect((await connect()).client.closedWith).toBe(4402);
  });

  it("сбой при определении пользователя — service_unavailable и закрытие, без утечки текста ошибки", async () => {
    const { connect, logged } = await relayWith({
      resolveUser: async () => {
        throw new Error("сессия сломалась");
      },
    });
    const { client } = await connect();
    expect(client.messages).toEqual([{ type: "error", kind: "service_unavailable" }]);
    expect(client.closedWith).toBe(1011);
    expect(logged.join("\n")).toContain("сессия сломалась");
  });

  it("закрытие отказанного соединения не портит счётчик: отказ не занимает место", async () => {
    const { connect } = await relayWith({ maxConnectionsPerUser: 1, rateLimit: false, spendingLimits: exhausted });
    const refused = await connect();
    refused.connection.closed();
    expect(refused.client.closedWith).toBe(4402);
  });
});

describe("ретранслятор диалога: сообщения клиента", () => {
  it.each([
    ["не JSON", "не json"],
    ["другой тип первым", JSON.stringify({ type: "ping" })],
    ["неверный формат звука", JSON.stringify({ type: "start", audio: { format: "opus", sampleRate: 16000, channels: 1 } })],
  ])("неверное первое сообщение (%s) — 4400", async (_name, first) => {
    const { connect } = await relayWith();
    const { client, connection } = await connect();
    connection.receive(first);
    await flush();
    expect(client.closedWith).toBe(4400);
  });

  it("бинарный кадр первым — 4400", async () => {
    const { connect } = await relayWith();
    const { client, connection } = await connect();
    connection.receive(new Uint8Array([1, 2, 3]));
    await flush();
    expect(client.closedWith).toBe(4400);
  });

  it("неизвестная команда и второй start — 4400", async () => {
    const { ready } = await relayWith();
    const first = await ready();
    first.connection.receive(JSON.stringify({ type: "самоуничтожение" }));
    await flush();
    expect(first.client.closedWith).toBe(4400);
    const second = await ready();
    second.connection.receive(JSON.stringify(START));
    await flush();
    expect(second.client.closedWith).toBe(4400);
  });

  it("сообщения, пришедшие до конца допуска, обрабатываются по порядку", async () => {
    const { relay } = await relayWith();
    const client = new FakeClient();
    const connection = relay.accept(client, new Request("http://app.test/stream?chatId=chat-1", { headers: { "x-user": "anna" } }));
    connection.receive(JSON.stringify(START));
    connection.receive(new Uint8Array([1]));
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.closedWith).toBeUndefined();
  });

  it("звук (Uint8Array и ArrayBuffer) уходит в Soniox", async () => {
    const { ready } = await relayWith();
    const { connection } = await ready();
    connection.receive(new Uint8Array([1, 2, 3]));
    connection.receive(new Uint8Array([4, 5]).buffer);
    await flush();
    expect(FakeSocket.instances[0]!.audio).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
  });
});

describe("ретранслятор диалога: готовность и голос", () => {
  it("«готово»: голос по умолчанию, пределы, speech: true", async () => {
    const { ready } = await relayWith();
    const { client } = await ready();
    expect(client.messages).toEqual([{ type: "ready", maxSessionSeconds: 1800, idleSeconds: 180, voiceId: "voice-1", speech: true }]);
  });

  it("выбранный человеком голос из списка берётся из хранилища; неизвестный — голос по умолчанию без ошибки", async () => {
    const chosen = await relayWith({}, async (storage) => void (await storage.setVoiceChoice?.("anna", "voice-2")));
    expect((await chosen.ready()).client.messages[0]).toMatchObject({ voiceId: "voice-2" });
    const stale = await relayWith({}, async (storage) => void (await storage.setVoiceChoice?.("anna", "удалённый-голос")));
    expect((await stale.ready()).client.messages[0]).toMatchObject({ voiceId: "voice-1" });
  });

  it("готовый каталог голосов (его же знает чат: у голоса свой набор тегов) вместо списка: relay.voices — тот же каталог", async () => {
    const storage = createInMemoryChatStorage();
    await storage.setVoiceChoice?.("anna", "voice-2");
    const catalog = createVoiceCatalog({
      voices: [
        { id: "voice-1", name: "Диктор", tags: { allowed: ["sighs"] } },
        { id: "voice-2", name: "Пират", tags: { allowed: ["laughs"] } },
      ],
      defaultVoiceId: "voice-1",
      storage,
    });

    const relay = createDialogRelay({
      storage,
      resolveUser: async () => ({ id: "anna" }),
      speech: { catalog, pricePerThousandChars: { eleven_v4_turbo: 0.05 }, apiKey: ELEVEN_KEY, connect: connectFake },
      logError: () => {},
    });

    expect(relay.voices).toBe(catalog);
    expect(await relay.voices!.current("anna")).toBe("voice-2");
    expect(relay.voices!.tagsOf("voice-2")).toEqual({ allowed: ["laughs"] });
  });

  it("хранилище без getVoiceChoice — голос по умолчанию", async () => {
    const { ready, storage } = await relayWith({}, async (storage) => {
      delete (storage as { getVoiceChoice?: unknown }).getVoiceChoice;
    });
    expect(storage.getVoiceChoice).toBeUndefined();
    expect((await ready()).client.messages[0]).toMatchObject({ voiceId: "voice-1" });
  });

  it("команда voice меняет голос следующей реплики (только из списка) и запоминается, если хранилище умеет", async () => {
    const { ready, storage } = await relayWith();
    const { connection } = await ready();
    connection.receive(JSON.stringify({ type: "voice", voiceId: "voice-2" }));
    connection.receive(JSON.stringify({ type: "voice", voiceId: "чужой" }));
    connection.receive(JSON.stringify({ type: "prepare", replyId: 1 }));
    await flush();
    FakeSocket.instances[1]!.open();
    expect(FakeSocket.instances[1]!.messages[0]).toEqual({ voices: ["voice-2"] });
    expect(await storage.getVoiceChoice?.("anna")).toBe("voice-2");
  });

  it("один источник правды: выбор голоса идёт через каталог relay.voices, а не мимо него (хранилище без методов голоса)", async () => {
    const { relay, ready } = await relayWith({}, async (storage) => {
      delete (storage as { getVoiceChoice?: unknown }).getVoiceChoice;
      delete (storage as { setVoiceChoice?: unknown }).setVoiceChoice;
    });
    expect(await relay.voices?.select("anna", "voice-2")).toBe(true);
    expect((await ready()).client.messages[0]).toMatchObject({ voiceId: "voice-2" });
  });

  it("команда voice по сокету попадает в тот же каталог, что и HTTP (`relay.voices.current`)", async () => {
    const { relay, ready } = await relayWith({}, async (storage) => {
      delete (storage as { getVoiceChoice?: unknown }).getVoiceChoice;
      delete (storage as { setVoiceChoice?: unknown }).setVoiceChoice;
    });
    const { connection } = await ready();
    connection.receive(JSON.stringify({ type: "voice", voiceId: "voice-2" }));
    connection.receive(JSON.stringify({ type: "voice", voiceId: "чужой" }));
    await flush();
    expect(await relay.voices?.current("anna")).toBe("voice-2");
    expect(await relay.voices?.view("anna")).toMatchObject({ current: "voice-2", persisted: false });
  });

  it("без настройки озвучки каталога голосов нет", async () => {
    const { relay } = await relayWith({ speech: undefined });
    expect(relay.voices).toBeNull();
  });

  it("нет ключа ElevenLabs — «готово» с speech: false, режим слушает", async () => {
    const { ready } = await relayWith({
      speech: { voices: [{ id: "voice-1", name: "Диктор" }], defaultVoiceId: "voice-1", pricePerThousandChars: { eleven_v4_turbo: 0.05 }, env: {} },
    });
    const { client, connection } = await ready();
    expect(client.messages[0]).toMatchObject({ type: "ready", speech: false });
    connection.receive(JSON.stringify({ type: "prepare", replyId: 1 }));
    await flush();
    expect(client.messages.at(-1)).toEqual({ type: "speech_failed", replyId: 1, kind: "unavailable" });
  });

  it("нет ключа Soniox — service_unavailable и 4502; в журнале про ключ, но не сам ключ", async () => {
    const { connect, logged } = await relayWith({ recognition: { env: {}, connectUpstream: connectFake } });
    const { client, connection } = await connect();
    connection.receive(JSON.stringify(START));
    await flush();
    expect(client.messages).toEqual([{ type: "error", kind: "service_unavailable" }]);
    expect(client.closedWith).toBe(4502);
    expect(logged.join("\n")).toContain("SONIOX_API_KEY");
  });

  it("ключи берутся из env сервера, если не заданы явно", async () => {
    const { ready } = await relayWith({
      speech: { voices: [{ id: "v", name: "V" }], defaultVoiceId: "v", pricePerThousandChars: { eleven_v4_turbo: 0.05 }, env: { ELEVENLABS_API_KEY: ELEVEN_KEY }, connect: connectFake },
      recognition: { env: { SONIOX_API_KEY: SONIOX_KEY }, connectUpstream: connectFake },
    });
    const { connection } = await ready();
    connection.receive(JSON.stringify({ type: "prepare", replyId: 1 }));
    await flush();
    expect(FakeSocket.instances[1]!.headers["xi-api-key"]).toBe(ELEVEN_KEY);
  });
});

describe("ретранслятор диалога: настройка сервера", () => {
  const base = { voices: [{ id: "v1", name: "Один" }], defaultVoiceId: "v1", pricePerThousandChars: { eleven_v4_turbo: 0.05 } };
  const build = (speech: DialogRelayOptions["speech"]) => () =>
    createDialogRelay({ storage: createInMemoryChatStorage(), resolveUser: async () => null, speech, logError: () => {} });

  it("цена озвучки не задана — сервер не стартует, с понятным сообщением", () => {
    expect(build({ ...base, pricePerThousandChars: {} })).toThrow(/pricePerThousandChars/);
    expect(build({ ...base, model: "eleven_v4", pricePerThousandChars: { eleven_v4_turbo: 0.05 } })).toThrow(/eleven_v4/);
  });

  it("список голосов пуст или голос по умолчанию не из списка — ошибка", () => {
    expect(build({ ...base, voices: [] })).toThrow(/voices/);
    expect(build({ ...base, defaultVoiceId: "нет" })).toThrow(/defaultVoiceId/);
  });

  it("верная настройка принимается", () => {
    expect(build(base)).not.toThrow();
  });
});

describe("ретранслятор диалога: сквозной путь и ключи", () => {
  it("фраза → prepare → speak → звук кадром клиенту → end_reply → speech_done", async () => {
    const { ready } = await relayWith();
    const { client, connection } = await ready();
    FakeSocket.instances[0]!.receive({ tokens: [{ text: "Привет", is_final: true }, { text: "<end>", is_final: true }] });
    connection.receive(JSON.stringify({ type: "prepare", replyId: 1 }));
    connection.receive(JSON.stringify({ type: "speak", replyId: 1, text: "Здравствуйте." }));
    await flush();
    const speech = FakeSocket.instances[1]!;
    speech.open();
    speech.receive(speechChunk("Здравствуйте. ", 900));
    connection.receive(JSON.stringify({ type: "end_reply", replyId: 1 }));
    await flush();
    speech.receive({ is_final: true });
    expect(client.messages.map((message) => message.type)).toEqual(["ready", "heard", "phrase_end", "speech_started", "speech_done"]);
    expect(client.frames).toHaveLength(1);
    expect(client.frames[0]!.replyId).toBe(1);
  });

  it("ключи Soniox и ElevenLabs не попадают ни в одно сообщение клиенту, ни в журнал, ни в адрес соединения", async () => {
    const { ready, logged } = await relayWith();
    const { client, connection } = await ready();
    connection.receive(JSON.stringify({ type: "prepare", replyId: 1 }));
    connection.receive(JSON.stringify({ type: "speak", replyId: 1, text: "Привет." }));
    await flush();
    const speech = FakeSocket.instances[1]!;
    speech.open();
    speech.receive({ error: `denied ${ELEVEN_KEY}` });
    FakeSocket.instances[0]!.receive({ error_code: 500, error_message: `boom ${SONIOX_KEY}` });
    await flush();
    const everything = JSON.stringify(client.messages) + logged.join("\n") + FakeSocket.instances.map((socket) => socket.url).join("\n");
    expect(everything).not.toContain(SONIOX_KEY);
    expect(everything).not.toContain(ELEVEN_KEY);
    expect(client.closedWith).toBe(4502);
  });

  it("обрыв Soniox: error recognition_lost, закрытие 4502, соединение освобождено", async () => {
    const { ready, connect } = await relayWith({ maxConnectionsPerUser: 1, rateLimit: false });
    const { client } = await ready();
    FakeSocket.instances[0]!.drop(1006);
    expect(client.messages.at(-1)).toEqual({ type: "error", kind: "recognition_lost" });
    expect(client.closedWith).toBe(4502);
    expect((await connect()).client.closedWith).toBeUndefined();
  });

  it("отказ ElevenLabs — speech_failed(unavailable), режим продолжает слушать", async () => {
    const { ready } = await relayWith();
    const { client, connection } = await ready();
    connection.receive(JSON.stringify({ type: "prepare", replyId: 1 }));
    await flush();
    FakeSocket.instances[1]!.fail();
    expect(client.messages.at(-1)).toEqual({ type: "speech_failed", replyId: 1, kind: "unavailable" });
    FakeSocket.instances[0]!.receive({ tokens: [{ text: "Алло", is_final: true }, { text: "<end>", is_final: true }] });
    expect(client.messages.at(-1)).toMatchObject({ type: "phrase_end", text: "Алло" });
    expect(client.closedWith).toBeUndefined();
  });

  it("простой закрывает соединение кодом 4408 и освобождает место", async () => {
    const { ready, connect } = await relayWith({ idleSeconds: 60, maxConnectionsPerUser: 1, rateLimit: false });
    const { client } = await ready();
    vi.advanceTimersByTime(60_000);
    expect(client.closedWith).toBe(4408);
    expect((await connect()).client.closedWith).toBeUndefined();
  });

  it("клиент закрыл соединение: Soniox и озвучка закрыты", async () => {
    const { ready } = await relayWith();
    const { connection } = await ready();
    connection.receive(JSON.stringify({ type: "prepare", replyId: 1 }));
    await flush();
    connection.closed();
    expect(FakeSocket.instances[0]!.closed).toBe(true);
    expect(FakeSocket.instances[1]!.closed).toBe(true);
  });

  it("настройки времени доходят до сессии", async () => {
    const { ready } = await relayWith({ idleSeconds: 90, maxSessionSeconds: 300 });
    expect((await ready()).client.messages[0]).toMatchObject({ idleSeconds: 90, maxSessionSeconds: 300 });
  });
});

const speechWith = (extra: Partial<Omit<NonNullable<DialogRelayOptions["speech"]>, "voices" | "defaultVoiceId" | "catalog">>): NonNullable<DialogRelayOptions["speech"]> => ({
  voices: [{ id: "voice-1", name: "Диктор" }],
  defaultVoiceId: "voice-1",
  pricePerThousandChars: { eleven_v4_turbo: 0.05 },
  apiKey: ELEVEN_KEY,
  connect: connectFake,
  ...extra,
});
const speak = (replyId: number, text: string) => JSON.stringify({ type: "speak", replyId, text });
/** Предложение ровно в `length` знаков вместе с пробелом, который считает ElevenLabs. */
const sentenceOf = (length: number) => `${"а".repeat(length - 2)}.`;

describe("ретранслятор диалога: потолок знаков в минуту — на человека", () => {
  it("два соединения одного человека делят потолок: второе упирается в то, что потратило первое", async () => {
    const { ready } = await relayWith({ speech: speechWith({ maxCharsPerMinute: 100 }), rateLimit: false });
    const first = await ready();
    const second = await ready();
    first.connection.receive(speak(1, sentenceOf(60)));
    await flush();
    second.connection.receive(speak(1, sentenceOf(60)));
    await flush();
    expect(first.client.messages.filter((message) => message.type === "speech_failed")).toEqual([]);
    expect(second.client.messages).toContainEqual({ type: "speech_failed", replyId: 1, kind: "cap" });
  });

  it("переоткрытие сокета счёт не обнуляет", async () => {
    const { ready } = await relayWith({ speech: speechWith({ maxCharsPerMinute: 100 }), rateLimit: false });
    const first = await ready();
    first.connection.receive(speak(1, sentenceOf(60)));
    await flush();
    first.connection.closed();
    const again = await ready();
    again.connection.receive(speak(1, sentenceOf(60)));
    await flush();
    expect(again.client.messages).toContainEqual({ type: "speech_failed", replyId: 1, kind: "cap" });
  });

  it("у другого человека счёт свой; через минуту потолок снова свободен", async () => {
    const { ready } = await relayWith({ speech: speechWith({ maxCharsPerMinute: 100 }), rateLimit: false });
    const anna = await ready();
    anna.connection.receive(speak(1, sentenceOf(90)));
    await flush();
    const boris = await ready({ user: "boris", chatId: "chat-2" });
    boris.connection.receive(speak(1, sentenceOf(90)));
    await flush();
    expect(boris.client.messages.filter((message) => message.type === "speech_failed")).toEqual([]);

    anna.connection.receive(speak(1, sentenceOf(90)));
    await flush();
    expect(anna.client.messages).toContainEqual({ type: "speech_failed", replyId: 1, kind: "cap" });
    vi.advanceTimersByTime(61_000);
    const later = await ready();
    later.connection.receive(speak(2, sentenceOf(90)));
    await flush();
    expect(later.client.messages.filter((message) => message.type === "speech_failed")).toEqual([]);
  });
});

describe("ретранслятор диалога: медленная команда не задерживает звук", () => {
  it("mark_cut ждёт базу, а звук с микрофона уходит в Soniox сразу", async () => {
    const { ready, storage } = await relayWith();
    const { connection } = await ready();
    storage.getMessage = () => new Promise(() => {});
    connection.receive(JSON.stringify({ type: "mark_cut", replyId: 1, messageId: "m-1", partIndex: 0, charOffset: 3, spokenTail: "при" }));
    connection.receive(new Uint8Array([1, 2, 3]));
    await flush();
    expect(FakeSocket.instances[0]!.audio).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it("prepare ждёт проверку лимита, а звук уходит сразу; команды после него идут по порядку", async () => {
    let calls = 0;
    let release!: () => void;
    const slow: SpendingLimits = {
      assertWithinLimit: () => {
        calls += 1;
        return calls === 1 ? Promise.resolve() : new Promise<void>((resolve) => (release = resolve));
      },
      status: async () => ({ state: "ok" }) as never,
    };
    const { ready } = await relayWith({ spendingLimits: slow });
    const { client, connection } = await ready();
    connection.receive(JSON.stringify({ type: "prepare", replyId: 1 }));
    connection.receive(speak(1, "Привет."));
    connection.receive(new Uint8Array([7]));
    await flush();
    expect(FakeSocket.instances[0]!.audio).toEqual([new Uint8Array([7])]);
    expect(FakeSocket.instances).toHaveLength(1);

    release();
    await flush();
    const speech = FakeSocket.instances[1]!;
    speech.open();
    expect(speech.messages.map((message) => Object.keys(message)[0])).toEqual(["voices", "inputs"]);
    expect(client.messages.filter((message) => message.type === "speech_failed")).toEqual([]);
  });
});

describe("ретранслятор диалога: подсказка распознаванию", () => {
  it("recognition.context уходит в Soniox в первом сообщении", async () => {
    const context = { general: [{ key: "domain", value: "погода" }], terms: ["Ярославль"] };
    const { ready } = await relayWith({ recognition: { apiKey: SONIOX_KEY, connectUpstream: connectFake, context } });
    await ready();
    expect(FakeSocket.instances[0]!.messages[0]).toMatchObject({ context });
  });

  it("без context в первом сообщении его нет", async () => {
    const { ready } = await relayWith();
    await ready();
    expect(FakeSocket.instances[0]!.messages[0]).not.toHaveProperty("context");
  });
});

describe("ретранслятор диалога: звуки человека (Scribe, FR-027)", () => {
  const sounds = (scribe: ReturnType<typeof scribeFake>, extra: Record<string, unknown> = {}) => ({ apiKey: ELEVEN_KEY, pricePerHour: 0.22, fetch: scribe.fetch, ...extra });
  const phraseEnds = (client: { messages: ServerMessage[] }) => client.messages.filter((message) => message.type === "phrase_end");
  const saidHello = async (connection: { receive(data: Uint8Array): void }) => {
    // Громкий звук: тишина по умолчанию в Scribe не уходит.
    connection.receive(new Uint8Array(new Int16Array(32_000).fill(3000).buffer));
    await flush();
    FakeSocket.instances[0]!.receive(sonioxWords(["привет"], { final: true, end: true }));
    await flush();
  };

  it("sounds задан: Scribe зовётся с настройками по умолчанию (scribe_v2, язык ru), звуки идут клиенту", async () => {
    const scribe = scribeFake();
    const { ready } = await relayWith({ sounds: sounds(scribe) });
    const { client, connection } = await ready();

    await saidHello(connection);

    expect(scribe.calls).toHaveLength(1);
    expect(scribe.calls[0]!.form.get("model_id")).toBe("scribe_v2");
    expect(scribe.calls[0]!.form.get("language_code")).toBe("ru");
    expect(scribe.calls[0]!.bytes).toBe(64_000);
    scribe.calls[0]!.reply(scribeSounds(["(laughter)", 1, 1.5]));
    await flush();
    expect(phraseEnds(client)[0]).toMatchObject({ text: "привет", sounds: [{ kind: "laughter", agoMs: 1000 }] });
  });

  it("настройки waitMs и model доходят до сессии", async () => {
    const scribe = scribeFake();
    const { ready } = await relayWith({ sounds: sounds(scribe, { waitMs: 700, model: "scribe_v1" }) });
    const { client, connection } = await ready();

    await saidHello(connection);
    expect(scribe.calls[0]!.form.get("model_id")).toBe("scribe_v1");
    await vi.advanceTimersByTimeAsync(699);
    expect(phraseEnds(client)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(phraseEnds(client)).toHaveLength(1);
  });

  it("по умолчанию ждём хвост 1000 мс, а тишина в Scribe не уходит", async () => {
    const scribe = scribeFake();
    const { ready } = await relayWith({ sounds: sounds(scribe) });
    const { client, connection } = await ready();

    connection.receive(new Uint8Array(64_000));
    await flush();
    FakeSocket.instances[0]!.receive(sonioxWords(["привет"], { final: true, end: true }));
    await flush();
    expect(scribe.calls).toHaveLength(0);
    expect(phraseEnds(client)).toHaveLength(1);

    await saidHello(connection);
    await vi.advanceTimersByTimeAsync(999);
    expect(phraseEnds(client)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(phraseEnds(client)).toHaveLength(2);
  });

  it("без настройки sounds Scribe не зовётся, конец фразы сразу", async () => {
    const { ready } = await relayWith();
    const { client, connection } = await ready();

    await saidHello(connection);

    expect(phraseEnds(client)).toHaveLength(1);
  });

  it("цена Scribe обязательна: без неё сервер не стартует, с понятным сообщением", () => {
    const build = (extra: Record<string, unknown>) => () =>
      createDialogRelay({ storage: createInMemoryChatStorage(), resolveUser: async () => null, sounds: { apiKey: "k", ...extra } as never, logError: () => {} });
    expect(build({})).toThrow(/pricePerHour/);
    expect(build({ pricePerHour: -1 })).toThrow(/pricePerHour/);
    expect(build({ pricePerHour: 0.22 })).not.toThrow();
  });

  it("нет ключа Scribe: режим работает без звуков, в журнале один раз сказано про ключ, самого ключа нет", async () => {
    const scribe = scribeFake();
    const { ready, logged } = await relayWith({ sounds: { pricePerHour: 0.22, env: {}, fetch: scribe.fetch } });
    const first = await ready();
    await saidHello(first.connection);
    FakeSocket.instances = [];
    await ready();

    expect(phraseEnds(first.client)).toHaveLength(1);
    expect(scribe.calls).toHaveLength(0);
    expect(logged.filter((line) => /ELEVENLABS_API_KEY/.test(line) && /Scribe|звук/i.test(line))).toHaveLength(1);
  });

  it("ключ Scribe берётся из env сервера, если не задан явно", async () => {
    const scribe = scribeFake();
    const { ready } = await relayWith({ sounds: { pricePerHour: 0.22, env: { ELEVENLABS_API_KEY: ELEVEN_KEY }, fetch: scribe.fetch } });
    const { connection } = await ready();

    await saidHello(connection);

    expect(scribe.calls).toHaveLength(1);
  });

  it("звуки работают и без озвучки: sounds без speech", async () => {
    const scribe = scribeFake();
    const { ready } = await relayWith({ speech: undefined, sounds: sounds(scribe) });
    const { client, connection } = await ready();

    await saidHello(connection);
    scribe.calls[0]!.reply(scribeSounds(["(sigh)", 0.5, 1]));
    await flush();

    expect(phraseEnds(client)[0]).toMatchObject({ sounds: [{ kind: "sigh" }] });
  });

  it("ключ Scribe не попадает ни в одно сообщение клиенту и не в журнал при сбое запроса", async () => {
    const scribe = scribeFake();
    const { ready, logged } = await relayWith({ sounds: sounds(scribe) });
    const { client, connection } = await ready();

    await saidHello(connection);
    scribe.calls[0]!.crash();
    await flush();

    expect(JSON.stringify(client.messages)).not.toContain(ELEVEN_KEY);
    expect(logged.join("\n")).not.toContain(ELEVEN_KEY);
    expect(logged.join("\n")).toMatch(/Scribe/);
  });
});
