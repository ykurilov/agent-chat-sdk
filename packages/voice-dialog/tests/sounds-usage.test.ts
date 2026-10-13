import { SpendingLimitReachedError, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { SpendingLimits } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createSoundsUsage } from "../src/server/sounds-usage";

const exhausted: SpendingLimits = {
  assertWithinLimit: async () => {
    throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
  },
  status: async () => ({ state: "exhausted" }),
};

function setup(extra: Partial<Parameters<typeof createSoundsUsage>[0]> = {}) {
  const storage = createInMemoryChatStorage();
  const inserted: unknown[] = [];
  const original = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    inserted.push(record);
    return original(record);
  };
  const logged: string[] = [];
  const usage = createSoundsUsage({
    storage,
    model: "scribe_v2",
    pricePerHour: 0.36,
    now: () => Date.parse("2026-10-01T10:00:00.000Z"),
    logError: (message) => logged.push(message),
    ...extra,
  });
  return { usage, storage, inserted, logged };
}

describe("расход звуков человека (Scribe)", () => {
  it("одна запись source: sounds: секунды в inputTokens, доллары = секунды / 3600 × цена за час, провайдер elevenlabs", async () => {
    const { usage, inserted } = setup();

    await usage.record({ ownerId: "anna", chatId: "chat-1", seconds: 36, startedAt: Date.parse("2026-10-01T09:59:00.000Z") });

    expect(inserted).toEqual([
      {
        id: expect.any(String),
        ownerId: "anna",
        chatId: "chat-1",
        messageId: null,
        source: "sounds",
        modelId: "scribe_v2",
        providerId: "elevenlabs",
        inputTokens: 36,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: 0.0036,
        createdAt: "2026-10-01T09:59:00.000Z",
      },
    ]);
  });

  it("дробные секунды (куски с перекрытием): цена по точной длине, токены — вверх", async () => {
    const { usage, inserted } = setup();
    await usage.record({ ownerId: "anna", chatId: "chat-1", seconds: 1.5 });
    expect(inserted[0]).toMatchObject({ inputTokens: 2 });
    expect((inserted[0] as { costUsd: number }).costUsd).toBeCloseTo(0.00015, 9);
  });

  it("запись попадает в суммы расходов человека", async () => {
    const { usage, storage } = setup();
    await usage.record({ ownerId: "anna", chatId: "chat-1", seconds: 3600 });
    const [sum] = await storage.sumUsage({ ownerId: "anna" });
    expect(sum?.costUsd).toBeCloseTo(0.36, 6);
  });

  it("без startedAt — время «сейчас»; нулевая длина не пишется", async () => {
    const { usage, inserted } = setup();
    await usage.record({ ownerId: "anna", chatId: "chat-1", seconds: 0 });
    await usage.record({ ownerId: "anna", chatId: "chat-1", seconds: 10 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ createdAt: "2026-10-01T10:00:00.000Z" });
  });

  it("сбой хранилища уходит в журнал и не бросает", async () => {
    const { usage, storage, logged } = setup();
    storage.insertUsageRecord = async () => {
      throw new Error("диск");
    };
    await expect(usage.record({ ownerId: "anna", chatId: "chat-1", seconds: 10 })).resolves.toBeUndefined();
    expect(logged.join("\n")).toMatch(/Звуки.*расход/);
  });

  it("цена обязательна и не отрицательна", () => {
    expect(() => setup({ pricePerHour: Number.NaN })).toThrow(/pricePerHour/);
    expect(() => setup({ pricePerHour: -1 })).toThrow(/pricePerHour/);
    expect(() => setup({ pricePerHour: undefined as never })).toThrow(/pricePerHour/);
  });

  it("лимит расходов: без лимитов можно; исчерпан — нельзя; сбой проверки — нельзя, но без исключения", async () => {
    expect(await setup().usage.canDetect({ userId: "anna", chatId: "chat-1" })).toBe(true);
    expect(await setup({ spendingLimits: exhausted }).usage.canDetect({ userId: "anna", chatId: "chat-1" })).toBe(false);
    const broken: SpendingLimits = { assertWithinLimit: async () => Promise.reject(new Error("база")), status: async () => ({ state: "ok" }) } as never;
    const { usage, logged } = setup({ spendingLimits: broken });
    expect(await usage.canDetect({ userId: "anna", chatId: "chat-1" })).toBe(false);
    expect(logged.join("\n")).toMatch(/Звуки/);
  });
});
