import { SpendingLimitReachedError, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { SpendingLimits, UsageRecord } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILLER_PHRASES, createFillerLibrary } from "../src/server/fillers";
import type { FillerLibrary } from "../src/server/fillers";
import { createSpeechUsage } from "../src/server/speech-usage";
import { FILLER_CATEGORIES } from "../src/protocol";
import { FakeSocket, base64Pcm, connectFake } from "./support/fake-socket";
import { ELEVEN_KEY } from "./support/session-harness";

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
});
afterEach(() => vi.useRealTimers());

const flush = async () => {
  for (let step = 0; step < 30; step += 1) await Promise.resolve();
};

const exhausted: SpendingLimits = {
  assertWithinLimit: async () => {
    throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
  },
  status: async () => ({ state: "exhausted" }),
};

function setup(
  options: { spendingLimits?: SpendingLimits; speech?: boolean; phrases?: Parameters<typeof createFillerLibrary>[0]["phrases"]; maxParallel?: number } = {},
) {
  const storage = createInMemoryChatStorage();
  const records: UsageRecord[] = [];
  const insert = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    records.push(record);
    return insert(record);
  };
  const logged: string[] = [];
  let time = 1_000_000;
  const usage = createSpeechUsage({
    storage,
    model: "eleven_v4_turbo",
    pricePerThousandChars: { eleven_v4_turbo: 0.05 },
    spendingLimits: options.spendingLimits,
    now: () => time,
    logError: (message) => logged.push(message),
  });
  const library: FillerLibrary = createFillerLibrary({
    phrases: options.phrases,
    speech: () => (options.speech === false ? null : { apiKey: ELEVEN_KEY, model: "eleven_v4_turbo", language: "ru", connect: connectFake }),
    usage,
    now: () => time,
    logError: (message) => logged.push(message),
    ...(options.maxParallel !== undefined && { maxParallel: options.maxParallel }),
  });
  const ask = (phraseId: string, extra: Partial<{ userId: string; chatId: string; voiceId: string }> = {}) =>
    library.audio({ userId: "anna", chatId: "chat-1", voiceId: "voice-1", phraseId, ...extra });
  return {
    library,
    ask,
    records,
    logged,
    storage,
    tick: (ms: number) => void (time += ms),
    /** Сокет синтеза: открылся и отдал звук `bytes` байт, озвучка закончилась. */
    async answer(socket: FakeSocket, bytes = 4800, fill = 1) {
      socket.open();
      socket.receive({ audio: base64Pcm(bytes, fill) });
      socket.receive({ is_final: true });
      await flush();
    },
  };
}

const textOf = (socket: FakeSocket) => {
  const sentence = socket.messages.find((message) => Array.isArray(message.inputs)) as { inputs: Array<{ text: string; voice_id: string }> } | undefined;
  return sentence?.inputs[0];
};

describe("список фраз", () => {
  it("по умолчанию — все виды, у каждого не меньше двух фраз (чтобы было что чередовать); идентификаторы разные", () => {
    const { library } = setup();
    const { phrases } = library.manifest();

    for (const category of FILLER_CATEGORIES) expect(phrases.filter((phrase) => phrase.category === category).length).toBeGreaterThanOrEqual(2);
    expect(new Set(phrases.map((phrase) => phrase.id)).size).toBe(phrases.length);
    expect(phrases.find((phrase) => phrase.text === "Сейчас поищу в интернете.")?.category).toBe("web");
    expect(phrases.find((phrase) => phrase.text === "Дай-ка вспомню.")?.category).toBe("memory");
    expect(phrases.find((phrase) => phrase.text === "Ещё чуть-чуть…")?.category).toBe("long");
    expect(DEFAULT_FILLER_PHRASES.thinking).toContain("Хмм…");
  });

  it("свои фразы заменяют умолчание вида; остальные виды остаются", () => {
    const { library } = setup({ phrases: { web: ["Ищу.", "Ищу-ищу."] } });
    const { phrases } = library.manifest();

    expect(phrases.filter((phrase) => phrase.category === "web").map((phrase) => phrase.text)).toEqual(["Ищу.", "Ищу-ищу."]);
    expect(phrases.some((phrase) => phrase.category === "thinking")).toBe(true);
  });

  it("вид можно очистить пустым списком: таких заполнителей не будет", () => {
    const { library } = setup({ phrases: { long: [] } });

    expect(library.manifest().phrases.some((phrase) => phrase.category === "long")).toBe(false);
  });
});

describe("звук фразы", () => {
  it("первый запрос синтезирует: выбранный голос, фраза, модель и язык — как у озвучки; ответ — звук целиком", async () => {
    const { library, ask, answer } = setup();
    const phrase = library.manifest().phrases[0]!;

    const pending = ask(phrase.id, { voiceId: "voice-7" });
    await flush();
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toContain("model_id=eleven_v4_turbo");
    expect(socket.url).toContain("output_format=pcm_24000");
    expect(socket.url).toContain("language_code=ru");
    expect(socket.headers["xi-api-key"]).toBe(ELEVEN_KEY);
    await answer(socket, 4800, 7);

    const result = await pending;
    expect(textOf(socket)).toEqual({ text: `${phrase.text} `, voice_id: "voice-7" });
    expect(result).toEqual({ ok: true, pcm: expect.any(Uint8Array) });
    if (result.ok) {
      expect(result.pcm.length).toBe(4800);
      expect(result.pcm[0]).toBe(7);
    }
  });

  it("звук из нескольких кусков склеивается по порядку", async () => {
    const { library, ask } = setup();
    const pending = ask(library.manifest().phrases[0]!.id);
    await flush();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ audio: base64Pcm(100, 1) });
    socket.receive({ audio: base64Pcm(60, 2) });
    socket.receive({ is_final: true });

    const result = await pending;

    expect(result.ok && result.pcm.length).toBe(160);
    expect(result.ok && [result.pcm[0], result.pcm[100]]).toEqual([1, 2]);
  });

  it("второй запрос той же фразы тем же голосом — из кэша: нового соединения нет, звук тот же", async () => {
    const { library, ask, answer } = setup();
    const id = library.manifest().phrases[0]!.id;
    const first = ask(id);
    await flush();
    await answer(FakeSocket.instances[0]!);
    await first;

    const second = await ask(id, { userId: "boris", chatId: "chat-2" });

    expect(FakeSocket.instances).toHaveLength(1);
    expect(second.ok).toBe(true);
  });

  it("другой голос — отдельный звук (своё соединение)", async () => {
    const { library, ask, answer } = setup();
    const id = library.manifest().phrases[0]!.id;
    const first = ask(id, { voiceId: "voice-1" });
    await flush();
    await answer(FakeSocket.instances[0]!);
    await first;

    const second = ask(id, { voiceId: "voice-2" });
    await flush();

    expect(FakeSocket.instances).toHaveLength(2);
    await answer(FakeSocket.instances[1]!);
    expect((await second).ok).toBe(true);
  });

  it("одновременные запросы одной фразы ждут один синтез", async () => {
    const { library, ask, answer, records } = setup();
    const id = library.manifest().phrases[0]!.id;

    const a = ask(id);
    const b = ask(id, { userId: "boris", chatId: "chat-2" });
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    await answer(FakeSocket.instances[0]!);

    expect((await a).ok && (await b).ok).toBe(true);
    expect(records).toHaveLength(1);
  });

  it("такой фразы нет — отказ «unknown», в ElevenLabs никто не ходил", async () => {
    const { ask } = setup();

    expect(await ask("нет-такой")).toEqual({ ok: false, reason: "unknown" });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("озвучки на сервере нет (ключа нет) — «unavailable»", async () => {
    const { library, ask } = setup({ speech: false });

    expect(await ask(library.manifest().phrases[0]!.id)).toEqual({ ok: false, reason: "unavailable" });
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

describe("расход", () => {
  it("пишется один раз при синтезе: на человека и чат, чей запрос вызвал синтез; знаки фразы с пробелом, источник speech, без сообщения", async () => {
    const { library, ask, answer, records } = setup();
    const phrase = library.manifest().phrases[0]!;

    const pending = ask(phrase.id, { userId: "anna", chatId: "chat-1" });
    await flush();
    await answer(FakeSocket.instances[0]!);
    await pending;

    const chars = phrase.text.length + 1;
    expect(records).toEqual([
      expect.objectContaining({ ownerId: "anna", chatId: "chat-1", messageId: null, source: "speech", modelId: "eleven_v4_turbo", providerId: "elevenlabs", inputTokens: chars, costUsd: (chars * 0.05) / 1000 }),
    ]);
  });

  it("из кэша — бесплатно: следующим людям записей нет", async () => {
    const { library, ask, answer, records } = setup();
    const id = library.manifest().phrases[0]!.id;
    const first = ask(id);
    await flush();
    await answer(FakeSocket.instances[0]!);
    await first;

    await ask(id, { userId: "boris", chatId: "chat-2" });
    await ask(id, { userId: "anna", chatId: "chat-3" });

    expect(records).toHaveLength(1);
  });

  it("лимит расходов исчерпан — синтеза нет, записи нет, отказ «limit»", async () => {
    const { library, ask, records } = setup({ spendingLimits: exhausted });

    expect(await ask(library.manifest().phrases[0]!.id)).toEqual({ ok: false, reason: "limit" });
    expect(FakeSocket.instances).toHaveLength(0);
    expect(records).toEqual([]);
  });

  it("лимит исчерпан, но звук уже в кэше — отдаётся: он ничего не стоит", async () => {
    let blocked = false;
    const limits: SpendingLimits = {
      assertWithinLimit: async (input) => {
        if (blocked) await exhausted.assertWithinLimit(input);
      },
      status: async () => ({ state: "ok" }) as never,
    };
    const { library, ask, answer } = setup({ spendingLimits: limits });
    const id = library.manifest().phrases[0]!.id;
    const first = ask(id);
    await flush();
    await answer(FakeSocket.instances[0]!);
    await first;
    blocked = true;

    expect((await ask(id, { userId: "boris", chatId: "chat-2" })).ok).toBe(true);
  });
});

describe("сбои", () => {
  it("ElevenLabs оборвал — «unavailable», в кэш не кладётся; расход за ушедшие знаки пишется", async () => {
    const { library, ask, records } = setup();
    const id = library.manifest().phrases[0]!.id;
    const pending = ask(id);
    await flush();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.fail();

    expect(await pending).toEqual({ ok: false, reason: "unavailable" });
    expect(records).toHaveLength(1);
  });

  it("после сбоя та же фраза несколько секунд не запрашивается заново (не долбим сервис), потом пробуем", async () => {
    const { library, ask, answer, tick } = setup();
    const id = library.manifest().phrases[0]!.id;
    const first = ask(id);
    await flush();
    FakeSocket.instances[0]!.fail();
    await first;

    expect(await ask(id)).toEqual({ ok: false, reason: "unavailable" });
    expect(FakeSocket.instances).toHaveLength(1);

    tick(31_000);
    const retry = ask(id);
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
    await answer(FakeSocket.instances[1]!);
    expect((await retry).ok).toBe(true);
  });

  it("ElevenLabs молчит дольше срока — «unavailable», соединение закрыто", async () => {
    const { library, ask } = setup();
    const pending = ask(library.manifest().phrases[0]!.id);
    await flush();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(await pending).toEqual({ ok: false, reason: "unavailable" });
    expect(socket.closed).toBe(true);
  });

  it("ответ без звука — тоже «unavailable»: пустой заполнитель никому не нужен", async () => {
    const { library, ask } = setup();
    const pending = ask(library.manifest().phrases[0]!.id);
    await flush();
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.receive({ is_final: true });

    expect(await pending).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("нагрузка на ElevenLabs", () => {
  it("одновременных соединений не больше трёх: остальные ждут, пока освободится место", async () => {
    const { library, ask, answer } = setup();
    const ids = library.manifest().phrases.slice(0, 5).map((phrase) => phrase.id);

    const pending = ids.map((id) => ask(id));
    await flush();
    expect(FakeSocket.instances).toHaveLength(3);

    await answer(FakeSocket.instances[0]!);
    expect(FakeSocket.instances).toHaveLength(4);
    await answer(FakeSocket.instances[1]!);
    await answer(FakeSocket.instances[2]!);
    await answer(FakeSocket.instances[3]!);
    await answer(FakeSocket.instances[4]!);

    expect((await Promise.all(pending)).every((result) => result.ok)).toBe(true);
  });
});
