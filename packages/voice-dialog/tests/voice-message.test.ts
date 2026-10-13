import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SpendingLimitReachedError, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockElevenLabs, MOCK_MS_PER_CHAR } from "../../../apps/demo/server/mock-elevenlabs";
import { createVoiceReplies } from "../src/server";
import type { VoiceReplies } from "../src/server/voice-message";
import { FakeSocket, connectFake, speechChunk } from "./support/fake-socket";
import { readOggOpus } from "./support/ogg-reader";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const KEY = "eleven-secret-key-0123456789";
const PRICES = { eleven_v4_turbo: 0.11, eleven_v4: 0.22 };
const exhausted: SpendingLimits = {
  assertWithinLimit: async () => {
    throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
  },
  status: async () => ({ state: "exhausted" }),
};

function setup(extra: Partial<Parameters<typeof createVoiceReplies>[0]> = {}, storage: ChatStorage = createInMemoryChatStorage()) {
  const logged: string[] = [];
  const connected: Array<{ url: string; headers: Record<string, string> }> = [];
  const sockets: unknown[] = [];
  const replies: VoiceReplies = createVoiceReplies({
    apiKey: KEY,
    voiceId: "voice-1",
    model: "eleven_v4_turbo",
    language: "ru",
    storage,
    pricePerThousandChars: PRICES,
    logError: (message) => logged.push(message),
    connect: (url, headers) => {
      connected.push({ url, headers });
      const socket = createMockElevenLabs();
      sockets.push(socket);
      return socket;
    },
    ...extra,
  });
  return { replies, storage, logged, connected, sockets };
}

const input = (text: string, signal: AbortSignal = new AbortController().signal) => ({ text, ownerId: "anna", chatId: "chat-1", messageId: "m-1", signal });

async function speakToEnd(replies: VoiceReplies, text: string, signal?: AbortSignal) {
  const pending = replies.speak(input(text, signal));
  await vi.advanceTimersByTimeAsync(10_000);
  return pending;
}

async function usageOf(storage: ChatStorage) {
  const records: unknown[] = [];
  const original = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    records.push(record);
    return original(record);
  };
  return records as Array<Record<string, unknown>>;
}

describe("голосовой ответ: озвучка и упаковка", () => {
  it("ответ озвучен целиком и упакован в Ogg/Opus: audio, mediaType audio/ogg, длительность по звуку", async () => {
    const { replies } = setup();
    const result = await speakToEnd(replies, "Привет, мир. Как дела?");
    if (!("audio" in result)) throw new Error(`ожидалось аудио, пришло ${JSON.stringify(result)}`);
    expect(result.mediaType).toBe("audio/ogg");
    const stream = readOggOpus(result.audio);
    expect(stream.pages.every((page) => page.checksum === page.computedChecksum)).toBe(true);
    expect(result.durationMs).toBe(stream.durationMs);
    // два предложения: каждое уходит с пробелом на конце
    expect(result.durationMs).toBe(("Привет, мир. ".length + "Как дела? ".length) * MOCK_MS_PER_CHAR);
  });

  it("траты записаны: source speech (озвучка), знаки, цена из настроек, провайдер elevenlabs, владелец, чат и сообщение", async () => {
    const storage = createInMemoryChatStorage();
    const records = await usageOf(storage);
    const { replies } = setup({}, storage);
    await speakToEnd(replies, "Привет, мир.");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ownerId: "anna",
      chatId: "chat-1",
      messageId: "m-1",
      source: "speech",
      modelId: "eleven_v4_turbo",
      providerId: "elevenlabs",
      inputTokens: "Привет, мир. ".length,
      costUsd: ("Привет, мир. ".length * 0.11) / 1000,
    });
  });

  it("цена берётся по выбранной модели", async () => {
    const storage = createInMemoryChatStorage();
    const records = await usageOf(storage);
    const { replies } = setup({ model: "eleven_v4" }, storage);
    await speakToEnd(replies, "Да.");
    expect(records[0]).toMatchObject({ modelId: "eleven_v4", costUsd: (4 * 0.22) / 1000 });
  });

  it("лимит расходов исчерпан: skipped limit, ElevenLabs не вызывался, трат нет", async () => {
    const storage = createInMemoryChatStorage();
    const records = await usageOf(storage);
    const { replies, connected } = setup({ spendingLimits: exhausted }, storage);
    expect(await replies.speak(input("Привет."))).toEqual({ skipped: "limit" });
    expect(connected).toHaveLength(0);
    expect(records).toHaveLength(0);
  });

  it("проверка лимита сломалась: skipped unavailable, ElevenLabs не вызывался, сбой в журнале", async () => {
    const broken: SpendingLimits = { assertWithinLimit: async () => Promise.reject(new Error("база недоступна")), status: async () => ({ state: "ok" }) } as SpendingLimits;
    const { replies, connected, logged } = setup({ spendingLimits: broken });
    expect(await replies.speak(input("Привет."))).toEqual({ skipped: "unavailable" });
    expect(connected).toHaveLength(0);
    expect(logged.join("\n")).toContain("база недоступна");
  });

  it("сбой озвучки: skipped unavailable, причина в logError, ключ в тексте ошибки спрятан", async () => {
    FakeSocket.instances = [];
    const { replies, logged } = setup({ connect: connectFake });
    const pending = replies.speak(input("Привет."));
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ error: `invalid api key ${KEY}` });
    expect(await pending).toEqual({ skipped: "unavailable" });
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain(KEY);
  });

  it("сбой после части звука: плата за отправленные знаки всё равно записана", async () => {
    FakeSocket.instances = [];
    const storage = createInMemoryChatStorage();
    const records = await usageOf(storage);
    const { replies } = setup({ connect: connectFake }, storage);
    const pending = replies.speak(input("Привет."));
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive(speechChunk("Привет. ", 200));
    socket.drop(1011);
    expect(await pending).toEqual({ skipped: "unavailable" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: "speech", inputTokens: "Привет. ".length });
  });

  it("тишина вместо звука (ElevenLabs закончил без единого куска): skipped unavailable", async () => {
    FakeSocket.instances = [];
    const { replies } = setup({ connect: connectFake });
    const pending = replies.speak(input("Привет."));
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ is_final: true });
    expect(await pending).toEqual({ skipped: "unavailable" });
  });

  it("signal обрывает: соединение закрыто, результат skipped, звук не упаковывается; уже отправленные знаки оплачены", async () => {
    FakeSocket.instances = [];
    const storage = createInMemoryChatStorage();
    const records = await usageOf(storage);
    const { replies } = setup({ connect: connectFake }, storage);
    const controller = new AbortController();
    const pending = replies.speak(input("Привет. Как дела?", controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    controller.abort();
    expect(await pending).toEqual({ skipped: "unavailable" });
    expect(socket.closed).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ inputTokens: "Привет. ".length + "Как дела? ".length });
  });

  it("signal уже сработал: ничего не вызывается", async () => {
    const { replies, connected } = setup();
    const controller = new AbortController();
    controller.abort();
    expect(await replies.speak(input("Привет.", controller.signal))).toEqual({ skipped: "unavailable" });
    expect(connected).toHaveLength(0);
  });

  it("baseUrl и headers прокси уходят в соединение, ключ — в заголовке xi-api-key", async () => {
    const { replies, connected } = setup({ baseUrl: "https://proxy.example.com/eleven", headers: { "x-proxy-token": "p-1" } });
    await speakToEnd(replies, "Привет.");
    expect(connected[0]!.url.startsWith("wss://proxy.example.com/eleven/v1/text-to-dialogue/stream-input?")).toBe(true);
    expect(connected[0]!.url).toContain("model_id=eleven_v4_turbo");
    expect(connected[0]!.url).toContain("output_format=pcm_24000");
    expect(connected[0]!.url).toContain("language_code=ru");
    expect(connected[0]!.headers).toMatchObject({ "x-proxy-token": "p-1", "xi-api-key": KEY });
    expect(connected[0]!.url).not.toContain(KEY);
  });

  it("код, таблица и схема озвучиваются короткой фразой, а не зачитываются", async () => {
    const { replies } = setup();
    const result = await speakToEnd(replies, "Вот так.\n```js\nconst secretCode = 1;\n```\n| а | б |\n|---|---|\n| 1 | 2 |\n```mermaid\nA-->B\n```");
    if (!("audio" in result)) throw new Error("ожидалось аудио");
    const spoken = "Вот так. код на экране таблица на экране схема на экране ";
    expect(result.durationMs).toBe(spoken.length * MOCK_MS_PER_CHAR);
  });

  it("метки голоса остаются в тексте для озвучки (их отыгрывает голос)", async () => {
    FakeSocket.instances = [];
    const { replies } = setup({ connect: connectFake });
    const pending = replies.speak(input("Ну вот [sighs] ладно."));
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    const sent = socket.messages.flatMap((message) => (message.inputs as Array<{ text: string }> | undefined) ?? []).map((item) => item.text);
    expect(sent.join("")).toContain("[sighs]");
    socket.receive({ is_final: true });
    await pending;
  });

  it("предел maxChars (по умолчанию 1500): длинный ответ обрезается, в конце «Дальше на экране.»", async () => {
    FakeSocket.instances = [];
    const { replies } = setup({ connect: connectFake });
    const sentence = "Это довольно длинное предложение для проверки предела озвучки. ";
    const pending = replies.speak(input(sentence.repeat(60)));
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    const sent = socket.messages.flatMap((message) => (message.inputs as Array<{ text: string }> | undefined) ?? []).map((item) => item.text).join("");
    expect(sent.length).toBeGreaterThan(1400);
    expect(sent.length).toBeLessThan(1500 + 2 * sentence.length + 30);
    expect(sent.trimEnd().endsWith("Дальше на экране.")).toBe(true);
    socket.receive({ is_final: true });
    await pending;
  });

  it("maxChars из настроек", async () => {
    FakeSocket.instances = [];
    const { replies } = setup({ connect: connectFake, maxChars: 100 });
    const pending = replies.speak(input("Короткое предложение номер один. ".repeat(20)));
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    const sent = socket.messages.flatMap((message) => (message.inputs as Array<{ text: string }> | undefined) ?? []).map((item) => item.text).join("");
    expect(sent.length).toBeLessThan(100 + 40 + "Дальше на экране.".length);
    socket.receive({ is_final: true });
    await pending;
  });

  it("текст без слов (одни знаки) — skipped unavailable без обращения к ElevenLabs", async () => {
    const { replies, connected } = setup();
    expect(await replies.speak(input("   \n  "))).toEqual({ skipped: "unavailable" });
    expect(await replies.speak(input("..."))).toEqual({ skipped: "unavailable" });
    expect(connected).toHaveLength(0);
  });

  it("два ответа подряд независимы: у каждого своё соединение и своя запись трат", async () => {
    const storage = createInMemoryChatStorage();
    const records = await usageOf(storage);
    const { replies, connected } = setup({}, storage);
    const first = replies.speak(input("Первый ответ."));
    const second = replies.speak({ ...input("Второй."), messageId: "m-2" });
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([first, second]);
    expect(connected).toHaveLength(2);
    expect(records.map((record) => record.messageId).sort()).toEqual(["m-1", "m-2"]);
  });
});

describe("SC-014: ответ на 500 знаков", () => {
  it("озвучен и упакован не дольше 5 с (время озвучки поддельного сервера плюс упаковка), траты по цене из настроек", async () => {
    const storage = createInMemoryChatStorage();
    const records = await usageOf(storage);
    const { replies } = setup({}, storage);
    const sentence = "Сегодня хорошая погода, и мы решили прогуляться по набережной. ";
    const text = sentence.repeat(Math.ceil(500 / sentence.length)).slice(0, 500).replace(/\s+\S*$/, ".");
    const started = fakeNow();
    const pending = replies.speak(input(text));
    let result: Awaited<typeof pending> | undefined;
    pending.then((value) => (result = value));
    while (!result) await vi.advanceTimersByTimeAsync(20);
    const fakeElapsed = fakeNow() - started;
    expect(fakeElapsed).toBeLessThanOrEqual(5_000);
    if (!("audio" in result)) throw new Error("ожидалось аудио");
    expect(result.durationMs).toBeGreaterThan(20_000);
    expect(readOggOpus(result.audio).pages.every((page) => page.checksum === page.computedChecksum)).toBe(true);
    const chars = records[0]!.inputTokens as number;
    expect(chars).toBeGreaterThan(450);
    expect(records[0]!.costUsd).toBeCloseTo((chars * 0.11) / 1000, 10);
  });

  it("сама упаковка (перекодирование и Ogg) для ответа на 500 знаков — доли секунды по настоящим часам", async () => {
    vi.useRealTimers();
    const { encodePcmToOggOpus } = await import("../src/server/ogg-opus");
    const { sinePcm24k } = await import("./support/ogg-reader");
    const began = performance.now();
    await encodePcmToOggOpus(sinePcm24k(30_000));
    expect(performance.now() - began).toBeLessThan(2_500);
  });
});

const fakeNow = () => Date.now();

describe("экспорт и бандл", () => {
  it("createVoiceReplies доступен из voice-dialog/server", async () => {
    const server = await import("../src/server");
    expect(typeof server.createVoiceReplies).toBe("function");
    expect(typeof server.encodePcmToOggOpus).toBe("function");
  });

  it("браузерный вход не доходит до кодировщика, упаковщика и озвучки целиком", () => {
    const seen = new Set<string>();
    const queue = [resolve(import.meta.dirname, "../src/index.ts")];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/["']opusscript["']/);
      for (const match of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
        const base = resolve(dirname(file), match[1]!);
        const target = [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find((path) => existsSync(path));
        if (target) queue.push(target);
      }
    }
    const names = [...seen].map((path) => path.replace(/.*\/src\//, ""));
    expect(names).not.toContain("server/ogg-opus.ts");
    expect(names).not.toContain("server/voice-message.ts");
  });
});
