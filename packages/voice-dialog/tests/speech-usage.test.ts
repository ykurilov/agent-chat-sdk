import { SpendingLimitReachedError, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpeechUsage } from "../src/server/speech-usage";
import { FakeSocket, speechChunk } from "./support/fake-socket";
import { sessionWith } from "./support/session-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const exhausted: SpendingLimits = {
  assertWithinLimit: async () => {
    throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
  },
  status: async () => ({ state: "exhausted" }),
};

function usageWith(storage: ChatStorage = createInMemoryChatStorage(), extra: Partial<Parameters<typeof createSpeechUsage>[0]> = {}) {
  const logged: string[] = [];
  const usage = createSpeechUsage({
    storage,
    model: "eleven_v4_turbo",
    pricePerThousandChars: { eleven_v4_turbo: 0.05, eleven_v4: 0.1 },
    now: () => Date.parse("2026-09-30T10:00:00.000Z"),
    logError: (message) => logged.push(message),
    ...extra,
  });
  return { usage, storage, logged };
}

describe("расход озвучки: запись", () => {
  it("одна запись source: speech: знаки в inputTokens, доллары = знаки / 1000 × цена, провайдер elevenlabs", async () => {
    const storage = createInMemoryChatStorage();
    const inserted: unknown[] = [];
    const original = storage.insertUsageRecord.bind(storage);
    storage.insertUsageRecord = async (record) => {
      inserted.push(record);
      return original(record);
    };
    const { usage } = usageWith(storage);
    await usage.record({ ownerId: "anna", chatId: "chat-1", messageId: "m-1", chars: 400, startedAt: Date.parse("2026-09-30T09:59:00.000Z") });
    expect(inserted).toEqual([
      {
        id: expect.any(String),
        ownerId: "anna",
        chatId: "chat-1",
        messageId: "m-1",
        source: "speech",
        modelId: "eleven_v4_turbo",
        providerId: "elevenlabs",
        inputTokens: 400,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: 0.02,
        createdAt: "2026-09-30T09:59:00.000Z",
      },
    ]);
  });

  it("сумма расхода растёт — а значит, растёт и то, что видят лимиты", async () => {
    const { usage, storage } = usageWith();
    await usage.record({ ownerId: "anna", chatId: "chat-1", messageId: null, chars: 1000, startedAt: 0 });
    await usage.record({ ownerId: "anna", chatId: "chat-1", messageId: null, chars: 2000, startedAt: 0 });
    const sums = await storage.sumUsage({ ownerId: "anna" });
    expect(sums).toEqual([expect.objectContaining({ modelId: "eleven_v4_turbo", providerId: "elevenlabs", inputTokens: 3000, costUsd: expect.closeTo(0.15, 10) })]);
  });

  it("ни одного знака не отправлено — записи нет", async () => {
    const { usage, storage } = usageWith();
    await usage.record({ ownerId: "anna", chatId: "chat-1", messageId: null, chars: 0, startedAt: 0 });
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);
  });

  it("eleven_v4 считается по своей цене", async () => {
    const { usage, storage } = usageWith(undefined, { model: "eleven_v4" });
    await usage.record({ ownerId: "anna", chatId: "chat-1", messageId: null, chars: 1000, startedAt: 0 });
    expect((await storage.sumUsage({}))[0]).toMatchObject({ modelId: "eleven_v4", costUsd: 0.1 });
  });

  it("хранилище отказало — в журнал, без исключения", async () => {
    const storage = createInMemoryChatStorage();
    storage.insertUsageRecord = async () => {
      throw new Error("диск полон");
    };
    const { usage, logged } = usageWith(storage);
    await expect(usage.record({ ownerId: "anna", chatId: "chat-1", messageId: null, chars: 10, startedAt: 0 })).resolves.toBeUndefined();
    expect(logged.join("\n")).toContain("диск полон");
  });
});

describe("расход озвучки: цена и лимит", () => {
  it("цена на используемую модель не задана — понятная ошибка при создании", () => {
    expect(() => usageWith(undefined, { pricePerThousandChars: { eleven_v4: 0.1 } })).toThrow(/pricePerThousandChars.*eleven_v4_turbo/);
    expect(() => usageWith(undefined, { pricePerThousandChars: {} })).toThrow(/eleven_v4_turbo/);
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])("цена %s — ошибка", (price) => {
    expect(() => usageWith(undefined, { pricePerThousandChars: { eleven_v4_turbo: price } })).toThrow(/pricePerThousandChars/);
  });

  it("assertCanSpeak: без лимитов — ok; лимит исчерпан — limit; сбой проверки — отказ, а не пропуск", async () => {
    expect(await usageWith().usage.assertCanSpeak({ userId: "anna", chatId: "chat-1" })).toBe("ok");
    expect(await usageWith(undefined, { spendingLimits: exhausted }).usage.assertCanSpeak({ userId: "anna", chatId: "chat-1" })).toBe("limit");
    const broken: SpendingLimits = { ...exhausted, assertWithinLimit: async () => Promise.reject(new Error("база недоступна")) };
    const { usage, logged } = usageWith(undefined, { spendingLimits: broken });
    expect(await usage.assertCanSpeak({ userId: "anna", chatId: "chat-1" })).toBe("unavailable");
    expect(logged.join("\n")).toContain("база недоступна");
  });
});

describe("расход озвучки: в сессии диалога", () => {
  it("лимит исчерпан: speech_failed(limit), к ElevenLabs — ни одного запроса, режим слушает дальше", async () => {
    const setup = sessionWith({ spendingLimits: exhausted });
    setup.begin();
    await setup.command({ type: "prepare", replyId: 1 });
    await setup.command({ type: "speak", replyId: 1, text: "Привет." });
    await setup.command({ type: "end_reply", replyId: 1 });
    expect(setup.of("speech_failed")).toEqual([{ type: "speech_failed", replyId: 1, kind: "limit" }]);
    expect(setup.speech()).toHaveLength(0);
    expect(await setup.storage.sumUsage({})).toEqual([]);
    setup.soniox().receive({ tokens: [{ text: "Привет", is_final: true }, { text: "<end>", is_final: true }] });
    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.closes).toEqual([]);
  });

  it("реплика записывает расход один раз: по знакам, реально ушедшим в ElevenLabs", async () => {
    const setup = sessionWith();
    setup.begin();
    await setup.command({ type: "prepare", replyId: 1 });
    const socket = setup.speech()[0]!;
    socket.open();
    await setup.command({ type: "speak", replyId: 1, text: "Первое предложение.", messageId: "m-1" });
    await setup.command({ type: "speak", replyId: 1, text: "Второе." });
    await setup.command({ type: "end_reply", replyId: 1 });
    socket.receive(speechChunk("Первое предложение. Второе. ", 2000));
    socket.receive({ is_final: true });
    await vi.waitFor(async () => expect(await setup.storage.sumUsage({})).toHaveLength(1));
    const [sum] = await setup.storage.sumUsage({ ownerId: "anna" });
    const sentTexts = socket.messages.flatMap((message) => (message.inputs as Array<{ text: string }> | undefined)?.map((input) => input.text) ?? []);
    expect(sum).toMatchObject({ modelId: "eleven_v4_turbo", providerId: "elevenlabs", inputTokens: sentTexts.join("").length });
    expect(sum!.costUsd).toBeCloseTo((sentTexts.join("").length / 1000) * 0.05, 10);
  });
});

/** Хранилище, где запись расхода идёт долго: по журналу видно, что закончилось раньше. */
function slowStorage(log: string[], writeMs = 200) {
  const storage = createInMemoryChatStorage();
  const original = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    log.push("запись:начата");
    await new Promise((resolve) => setTimeout(resolve, writeMs));
    await original(record);
    log.push("запись:готова");
  };
  return storage;
}

function limitsThatLog(log: string[]): SpendingLimits {
  return {
    assertWithinLimit: async () => void log.push("проверка лимита"),
    status: async () => ({ state: "ok" }) as never,
  };
}

describe("расход озвучки: запись раньше следующей проверки", () => {
  it("проверка лимита того же человека ждёт запись, начатую до неё, и видит её", async () => {
    const log: string[] = [];
    const { usage } = usageWith(slowStorage(log), { spendingLimits: limitsThatLog(log) });
    void usage.record({ ownerId: "anna", chatId: "chat-1", messageId: null, chars: 100, startedAt: 0 });
    const verdict = usage.assertCanSpeak({ userId: "anna", chatId: "chat-1" });
    await vi.advanceTimersByTimeAsync(200);
    expect(await verdict).toBe("ok");
    expect(log).toEqual(["запись:начата", "запись:готова", "проверка лимита"]);
  });

  it("проверка лимита другого человека не ждёт чужую запись", async () => {
    const log: string[] = [];
    const { usage } = usageWith(slowStorage(log), { spendingLimits: limitsThatLog(log) });
    void usage.record({ ownerId: "anna", chatId: "chat-1", messageId: null, chars: 100, startedAt: 0 });
    expect(await usage.assertCanSpeak({ userId: "boris", chatId: "chat-2" })).toBe("ok");
    expect(log).toEqual(["запись:начата", "проверка лимита"]);
  });

  it("сбой записи не ломает ожидание: проверка всё равно идёт", async () => {
    const storage = createInMemoryChatStorage();
    storage.insertUsageRecord = async () => {
      throw new Error("диск полон");
    };
    const { usage } = usageWith(storage, { spendingLimits: limitsThatLog([]) });
    void usage.record({ ownerId: "anna", chatId: "chat-1", messageId: null, chars: 100, startedAt: 0 });
    expect(await usage.assertCanSpeak({ userId: "anna", chatId: "chat-1" })).toBe("ok");
  });

  it("в сессии: следующая реплика не стартует, пока не записан расход предыдущей, и лимит видит эту запись", async () => {
    const log: string[] = [];
    const setup = sessionWith({ storage: slowStorage(log), spendingLimits: limitsThatLog(log) });
    setup.begin();
    await setup.command({ type: "prepare", replyId: 1 });
    log.length = 0;
    setup.speech()[0]!.open();
    await setup.command({ type: "speak", replyId: 1, text: "Первая реплика." });
    const second = setup.command({ type: "prepare", replyId: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(setup.speech()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await second;
    expect(log).toEqual(["запись:начата", "запись:готова", "проверка лимита"]);
    expect(setup.speech()).toHaveLength(2);
  });
});
