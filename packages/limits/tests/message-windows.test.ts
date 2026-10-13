import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpendingLimitReachedError, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ModelProfile } from "@ykurilov/agent-chat-core";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPgliteChatStorage } from "../../storage-postgres/tests/support/pglite-database";
import { createSpendingLimits } from "../src/create-spending-limits";
import type { SpendingLimitsOptions, SpendingWindowConfig } from "../src/create-spending-limits";

const flatModel: ModelProfile = {
  id: "flat-model",
  displayName: "Flat",
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true },
  providerModelIds: { openrouter: "flat/model" },
  pricing: { openrouter: { inputPerMillion: 1, outputPerMillion: 1 } },
};
const catalog = extendCatalog(standardCatalog, { addModels: [flatModel] });

// Среда, 7 октября 2026, 12:00 UTC. Сутки по UTC кончаются в полночь на 8-е.
const WEDNESDAY = "2026-10-07T12:00:00.000Z";
const NEXT_DAY = "2026-10-08T00:00:00.000Z";
const HOUR = 3_600_000;

function setup(windows: SpendingWindowConfig[], extra: Partial<SpendingLimitsOptions> = {}, storage: ChatStorage = createInMemoryChatStorage()) {
  const clock = { now: new Date(WEDNESDAY) };
  const logError = vi.fn();
  const limits = createSpendingLimits({ storage, catalog, windows, now: () => clock.now, logError, ...extra });
  const at = (iso: string) => (clock.now = new Date(iso));
  const later = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
  const take = (userId = "anna", chatId = "chat-1") => limits.takeMessage!({ userId, chatId });
  const refusalOf = async (userId = "anna", chatId = "chat-1") => {
    const failure = await take(userId, chatId).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SpendingLimitReachedError);
    return failure as SpendingLimitReachedError;
  };
  const windowOf = async (id: string, userId = "anna") => (await limits.status({ userId, chatId: "chat-1" })).windows!.find((window) => window.id === id);
  return { storage, limits, at, later, take, refusalOf, windowOf, logError };
}

async function takeTimes(take: () => Promise<unknown>, count: number) {
  for (let index = 0; index < count; index++) await take();
}

const dayOf = (limitMessages: SpendingWindowConfig["limitMessages"]): SpendingWindowConfig => ({ id: "day", scope: "user", kind: "calendar", unit: "day", limitMessages });

describe("окна сообщений: календарь, скользящее, на всё время", () => {
  it("сутки: 3 сообщения проходят, 4-е — отказ с unit messages и временем обновления; в новые сутки снова можно", async () => {
    const { take, refusalOf, at } = setup([dayOf(3)]);
    await takeTimes(take, 3);
    const refusal = await refusalOf();
    expect(refusal).toMatchObject({ unit: "messages", scope: "user", period: "day", resetsAt: NEXT_DAY, windowId: "day", reason: "limit" });
    at(NEXT_DAY);
    await expect(take()).resolves.not.toThrow();
  });

  it("статус окна сообщений: unit, limit, used, remaining; доля и состояние — как у денег (предупреждение с 80%)", async () => {
    const { take, windowOf, limits } = setup([dayOf(5)]);
    expect(await windowOf("day")).toEqual({ id: "day", scope: "user", period: "day", state: "ok", share: 0, resetsAt: NEXT_DAY, unit: "messages", limit: 5, used: 0, remaining: 5 });
    await takeTimes(take, 4);
    expect(await windowOf("day")).toMatchObject({ state: "warning", share: 0.8, used: 4, remaining: 1 });
    const status = await limits.status({ userId: "anna", chatId: "chat-1" });
    expect(status).toMatchObject({ state: "warning", windowId: "day", unit: "messages", remaining: 1 });
    await take();
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toMatchObject({ state: "exhausted", reason: "limit", unit: "messages", remaining: 0 });
  });

  it("скользящее 5 ч: окно от первого сообщения, а не от проверки; через 5 ч от первого — снова можно", async () => {
    const { take, refusalOf, later, windowOf, limits } = setup([{ id: "5h", scope: "user", kind: "rolling", hours: 5, limitMessages: 2 }]);
    // Проверка денег и статус окно сообщений не открывают.
    await limits.assertWithinLimit({ userId: "anna", chatId: "chat-1" });
    later(HOUR);
    expect(await windowOf("5h")).toMatchObject({ used: 0, resetsAt: null });
    await take();
    const opened = "2026-10-07T18:00:00.000Z";
    later(HOUR);
    await take();
    expect(await refusalOf()).toMatchObject({ unit: "messages", period: "rolling", hours: 5, resetsAt: opened });
    later(4 * HOUR);
    await take();
    expect(await windowOf("5h")).toMatchObject({ used: 1, resetsAt: "2026-10-07T23:00:00.000Z" });
  });

  it("на всё время: счёт не обнуляется, сброс окна вручную — обнуляет", async () => {
    const { take, refusalOf, at, limits, windowOf } = setup([{ id: "all", scope: "user", kind: "total", limitMessages: 2 }]);
    await takeTimes(take, 2);
    at("2027-10-07T12:00:00.000Z");
    expect(await refusalOf()).toMatchObject({ unit: "messages", period: "none", resetsAt: null });
    await limits.resetWindow({ windowId: "all", userId: "anna" });
    expect(await windowOf("all")).toMatchObject({ used: 0, remaining: 2 });
    await take();
  });

  it("окно чата считает сообщения этого чата, окно сервиса — всех людей вместе", async () => {
    const { take, refusalOf } = setup([
      { id: "chat", scope: "chat", kind: "total", limitMessages: 1 },
      { id: "service", scope: "service", kind: "total", limitMessages: 3 },
    ]);
    await take("anna", "chat-1");
    expect(await refusalOf("anna", "chat-1")).toMatchObject({ windowId: "chat", scope: "chat" });
    await take("anna", "chat-2");
    await take("boris", "chat-3");
    expect(await refusalOf("vera", "chat-4")).toMatchObject({ windowId: "service", scope: "service" });
  });

  it("отказ в одном окне не тратит место в другом", async () => {
    const { take, refusalOf, windowOf } = setup([dayOf(1), { id: "all", scope: "user", kind: "total", limitMessages: 10 }]);
    await take();
    await refusalOf();
    expect(await windowOf("all")).toMatchObject({ used: 1 });
  });

  it("исчерпаны два окна — в отказе то, что обновится позже", async () => {
    const { take, refusalOf } = setup([dayOf(1), { id: "week", scope: "user", kind: "calendar", unit: "week", limitMessages: 1 }]);
    await take();
    expect(await refusalOf()).toMatchObject({ windowId: "week" });
  });

  it("взятое место можно вернуть: сообщение так и не записали", async () => {
    const { take, windowOf } = setup([dayOf(3)]);
    await take();
    const giveBack = await take();
    expect(typeof giveBack).toBe("function");
    await giveBack!();
    expect(await windowOf("day")).toMatchObject({ used: 1 });
  });
});

describe("окна сообщений: гонка за последнее место", () => {
  it("десять сообщений разом на 3 места — проходят ровно три", async () => {
    const { take, windowOf } = setup([dayOf(3)]);
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => take("anna", `chat-${index}`)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((result) => result.status === "rejected").every((result) => (result as PromiseRejectedResult).reason instanceof SpendingLimitReachedError)).toBe(true);
    expect(await windowOf("day")).toMatchObject({ used: 3 });
  });
});

const openStorages: Array<{ close(): void | Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(openStorages.splice(0).map((storage) => storage.close()));
});

async function sqliteStorage(): Promise<ChatStorage> {
  const storage = createSqliteChatStorage({ filePath: join(mkdtempSync(join(tmpdir(), "message-windows-")), "chat.db") });
  openStorages.push(storage);
  return storage;
}

/** PostgreSQL: те же запросы и миграции, что в проде, на встроенной базе pglite. */
async function postgresStorage(): Promise<ChatStorage> {
  const storage = await createPgliteChatStorage();
  openStorages.push(storage);
  return storage;
}

const serviceWindow: SpendingWindowConfig = { id: "service", scope: "service", kind: "total", limitMessages: 1000 };

describe("окна сообщений: общее окно под нагрузкой", () => {
  for (const [name, storageOf] of [
    ["память", async () => createInMemoryChatStorage()],
    ["SQLite", sqliteStorage],
    ["PostgreSQL", postgresStorage],
  ] as const) {
    it(`${name}: 100 сообщений разом в окно сервиса на 1000 мест — ни одной ошибки, счёт точный`, async () => {
      const { take, windowOf } = setup([serviceWindow], {}, await storageOf());
      const results = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => take(`user-${index}`, `chat-${index}`)));
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      expect(await windowOf("service")).toMatchObject({ used: 100 });
    });

    it(`${name}: два сервера на одном хранилище, по 50 сообщений разом с каждого — ни одной ошибки, счёт точный`, async () => {
      const storage = await storageOf();
      const first = setup([serviceWindow], {}, storage);
      const second = setup([serviceWindow], {}, storage);
      const results = await Promise.allSettled(
        Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? first : second).take(`user-${index}`, `chat-${index}`)),
      );
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      expect(await first.windowOf("service")).toMatchObject({ used: 100 });
    });

    it(`${name}: возврат мест под нагрузкой — счёт точный`, async () => {
      const { take, windowOf } = setup([serviceWindow], {}, await storageOf());
      const giveBacks = await Promise.all(Array.from({ length: 60 }, (_, index) => take(`user-${index}`, `chat-${index}`)));
      const results = await Promise.allSettled(giveBacks.slice(0, 40).map((giveBack) => giveBack!()));
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      expect(await windowOf("service")).toMatchObject({ used: 20 });
    });

    it(`${name}: 10 сообщений разом на 3 последних места — проходят ровно три`, async () => {
      const { take, windowOf } = setup([{ ...serviceWindow, limitMessages: 3 }], {}, await storageOf());
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => take(`user-${index}`, `chat-${index}`)));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
      expect(results.filter((result) => result.status === "rejected").every((result) => (result as PromiseRejectedResult).reason instanceof SpendingLimitReachedError)).toBe(true);
      expect(await windowOf("service")).toMatchObject({ used: 3 });
    });
  }
});

describe("окна сообщений: возврат места не портит окно", () => {
  const rolling: SpendingWindowConfig = { id: "5h", scope: "user", kind: "rolling", hours: 5, limitMessages: 5 };

  it("отказ в другом окне не оставляет скользящее окно открытым", async () => {
    const { take, refusalOf, windowOf } = setup([rolling, dayOf(1)]);
    await take();
    expect(await windowOf("5h")).toMatchObject({ used: 1 });
    // Окно уже открыто первым сообщением: отказ его не трогает.
    await refusalOf();
    expect(await windowOf("5h")).toMatchObject({ used: 1, resetsAt: "2026-10-07T17:00:00.000Z" });
  });

  it("скользящее окно, открытое отказанной попыткой, снова закрыто", async () => {
    const { refusalOf, windowOf } = setup([rolling, dayOf(0)]);
    await refusalOf();
    expect(await windowOf("5h")).toMatchObject({ used: 0, resetsAt: null });
  });

  it("сообщение не записалось — скользящее окно, которое оно открыло, закрывается", async () => {
    const { take, windowOf, later } = setup([rolling]);
    const giveBack = await take();
    await giveBack!();
    expect(await windowOf("5h")).toMatchObject({ used: 0, resetsAt: null });
    later(2 * HOUR);
    await take();
    expect(await windowOf("5h")).toMatchObject({ used: 1, resetsAt: "2026-10-07T19:00:00.000Z" });
  });

  it("возврат в окно, открытое раньше, его не закрывает", async () => {
    const { take, windowOf } = setup([rolling]);
    await take();
    const giveBack = await take();
    await giveBack!();
    expect(await windowOf("5h")).toMatchObject({ used: 1, resetsAt: "2026-10-07T17:00:00.000Z" });
  });

  it("после ручного сброса окна возврат старого места новый счёт не уменьшает (на всё время)", async () => {
    const { take, windowOf, limits } = setup([{ id: "all", scope: "user", kind: "total", limitMessages: 5 }]);
    await take();
    const giveBack = await take();
    await limits.resetWindow({ windowId: "all", userId: "anna" });
    await take();
    await giveBack!();
    expect(await windowOf("all")).toMatchObject({ used: 1 });
  });

  it("после ручного сброса окна возврат старого места новый счёт не уменьшает (сутки)", async () => {
    const { take, windowOf, limits } = setup([dayOf(5)]);
    const giveBack = await take();
    await limits.resetWindow({ windowId: "day", userId: "anna" });
    await take();
    await giveBack!();
    expect(await windowOf("day")).toMatchObject({ used: 1 });
  });

  it("после ручного сброса скользящего окна возврат старого места новый счёт не уменьшает, даже в ту же миллисекунду", async () => {
    const { take, windowOf, limits } = setup([rolling]);
    const giveBack = await take();
    await limits.resetWindow({ windowId: "5h", userId: "anna" });
    await take();
    await giveBack!();
    expect(await windowOf("5h")).toMatchObject({ used: 1 });
  });
});

describe("окна сообщений: личные лимиты и исключения", () => {
  it("лимит функцией от человека: null — у этого человека окна нет", async () => {
    const { take, windowOf, refusalOf } = setup([dayOf(({ userId }) => (userId === "vip" ? null : 1))]);
    await takeTimes(() => take("vip"), 5);
    expect(await windowOf("day", "vip")).toBeUndefined();
    await take("anna");
    await refusalOf("anna");
  });

  it("свой лимит человека: число сообщений или null — без лимита; дробное число — ошибка", async () => {
    const { take, limits, refusalOf } = setup([dayOf(1)]);
    await limits.setUserSettings("anna", { limits: { day: 2 } });
    await takeTimes(take, 2);
    await refusalOf();
    await limits.setUserSettings("anna", { limits: { day: null } });
    await takeTimes(take, 5);
    await expect(limits.setUserSettings("anna", { limits: { day: 1.5 } })).rejects.toThrow(/day/);
  });

  it("exemptUsers: true — без ограничений во всех окнах, и денежных, и сообщений", async () => {
    const storage = createInMemoryChatStorage();
    await storage.insertUsageRecord({
      id: "u1",
      ownerId: "staff",
      chatId: "chat-1",
      messageId: null,
      source: "answer",
      modelId: "flat-model",
      providerId: "openrouter",
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 5,
      createdAt: WEDNESDAY,
    });
    const exemptUsers = vi.fn(async ({ userId }: { userId: string }) => userId === "staff");
    const { take, limits } = setup([dayOf(1), { id: "money", scope: "user", kind: "total", limitUsd: 1 }], { exemptUsers }, storage);
    await takeTimes(() => take("staff"), 3);
    await limits.assertWithinLimit({ userId: "staff", chatId: "chat-1" });
    expect(await limits.status({ userId: "staff", chatId: "chat-1" })).toMatchObject({ state: "ok", windows: [] });
    expect(exemptUsers).toHaveBeenCalledWith(expect.objectContaining({ userId: "staff" }));
    await take("anna");
    await expect(take("anna")).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });

  it("exemptUsers снимает окна, но не потолок хода: он защищает от бесконечного хода", async () => {
    const { limits } = setup([dayOf(1)], { exemptUsers: () => true, turn: { maxCostUsd: 0.5, maxToolCalls: 7, overrun: "stop" } });
    expect(await limits.turnRules!({ userId: "staff", chatId: "chat-1" })).toEqual({ maxCostUsd: 0.5, maxToolCalls: 7 });
  });
});

describe("окна сообщений: пороги", () => {
  it("onMessageThreshold: 80% и 100% по умолчанию, одно событие на порог; после сброса — снова", async () => {
    const onMessageThreshold = vi.fn();
    const { take, limits } = setup([dayOf(5)], { onMessageThreshold });
    await takeTimes(take, 3);
    expect(onMessageThreshold).not.toHaveBeenCalled();
    await take();
    expect(onMessageThreshold).toHaveBeenCalledTimes(1);
    expect(onMessageThreshold).toHaveBeenCalledWith({
      windowId: "day",
      scope: "user",
      period: "day",
      threshold: 0.8,
      share: 0.8,
      used: 4,
      limit: 5,
      remaining: 1,
      windowStart: "2026-10-07T00:00:00.000Z",
      resetsAt: NEXT_DAY,
      userId: "anna",
      chatId: "chat-1",
    });
    await take();
    expect(onMessageThreshold).toHaveBeenCalledTimes(2);
    expect(onMessageThreshold).toHaveBeenLastCalledWith(expect.objectContaining({ threshold: 1, used: 5, remaining: 0 }));
    await limits.resetWindow({ windowId: "day", userId: "anna" });
    await takeTimes(take, 4);
    expect(onMessageThreshold).toHaveBeenCalledTimes(3);
  });

  it("свои пороги — те же thresholds, что у денег; скользящее окно — с часами", async () => {
    const onMessageThreshold = vi.fn();
    const { take } = setup([{ id: "5h", scope: "user", kind: "rolling", hours: 5, limitMessages: 4 }], { onMessageThreshold, thresholds: [0.5] });
    await takeTimes(take, 4);
    expect(onMessageThreshold).toHaveBeenCalledTimes(1);
    expect(onMessageThreshold).toHaveBeenCalledWith(expect.objectContaining({ windowId: "5h", period: "rolling", hours: 5, threshold: 0.5, used: 2, remaining: 2 }));
  });

  it("порог окна сервиса называет человека, чьё сообщение до него дошло", async () => {
    const onMessageThreshold = vi.fn();
    const { take } = setup([{ id: "service", scope: "service", kind: "total", limitMessages: 2 }], { onMessageThreshold, thresholds: [1] });
    await take("anna", "chat-1");
    await take("boris", "chat-2");
    expect(onMessageThreshold).toHaveBeenCalledWith(expect.objectContaining({ windowId: "service", scope: "service", userId: "boris", chatId: "chat-2", windowStart: null, resetsAt: null }));
  });

  it("сообщение не прошло из-за другого окна — события нет, и порог не считается пройденным", async () => {
    const onMessageThreshold = vi.fn();
    const { take, refusalOf, limits } = setup([{ id: "all", scope: "user", kind: "total", limitMessages: 2 }, dayOf(1)], { onMessageThreshold, thresholds: [1] });
    const eventsOf = (windowId: string) => onMessageThreshold.mock.calls.filter(([event]) => event.windowId === windowId);
    await take();
    await refusalOf();
    expect(eventsOf("all")).toEqual([]);
    await limits.resetWindow({ windowId: "day", userId: "anna" });
    await take();
    expect(eventsOf("all")).toEqual([[expect.objectContaining({ threshold: 1, used: 2 })]]);
  });

  it("место вернули после события — второго события на тот же порог нет", async () => {
    const onMessageThreshold = vi.fn();
    const { take } = setup([dayOf(2)], { onMessageThreshold, thresholds: [1] });
    await take();
    const giveBack = await take();
    await giveBack!();
    await take();
    expect(onMessageThreshold).toHaveBeenCalledTimes(1);
  });

  it("ошибка обработчика — в журнал, сообщение проходит", async () => {
    const { take, logError } = setup([dayOf(1)], {
      onMessageThreshold: () => {
        throw new Error("почта упала");
      },
    });
    await expect(take()).resolves.toBeTypeOf("function");
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining("почта упала")));
  });

  it("без onMessageThreshold ничего нового: денежный onThreshold сообщений не видит", async () => {
    const onThreshold = vi.fn();
    const { take } = setup([dayOf(2), { id: "money", scope: "user", kind: "total", limitUsd: 1 }], { onThreshold });
    await takeTimes(take, 2);
    expect(onThreshold).not.toHaveBeenCalled();
  });
});

describe("окна сообщений рядом с денежными", () => {
  const mixed: SpendingWindowConfig[] = [dayOf(2), { id: "money", scope: "user", kind: "calendar", unit: "day", limitUsd: 1 }];

  it("проверка денег не считает сообщения, takeMessage не трогает деньги", async () => {
    const { take, limits, storage, windowOf } = setup(mixed);
    await takeTimes(take, 2);
    // Сообщения кончились, а деньги — нет: переделка и повтор идут.
    await limits.assertWithinLimit({ userId: "anna", chatId: "chat-1" });
    expect(await windowOf("money")).toEqual({ id: "money", scope: "user", period: "day", state: "ok", share: 0, resetsAt: NEXT_DAY, unit: "usd" });
    await storage.insertUsageRecord({
      id: "u1",
      ownerId: "anna",
      chatId: "chat-1",
      messageId: null,
      source: "answer",
      modelId: "flat-model",
      providerId: "openrouter",
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 2,
      createdAt: WEDNESDAY,
    });
    await expect(limits.assertWithinLimit({ userId: "anna", chatId: "chat-1" })).rejects.toMatchObject({ windowId: "money" });
    expect((await limits.assertWithinLimit({ userId: "anna", chatId: "chat-1" }).catch((error: SpendingLimitReachedError) => error))?.unit).toBeUndefined();
  });

  it("запас на старт и потолок хода смотрят только на деньги", async () => {
    const { take, limits } = setup(mixed, { turn: { minRemainingUsd: 0.5, overrun: "stop" } });
    await takeTimes(take, 1);
    await limits.assertWithinLimit({ userId: "anna", chatId: "chat-1" });
    expect(await limits.turnRules!({ userId: "anna", chatId: "chat-1" })).toEqual({ maxCostUsd: 1 });
  });

  it("отчёт для страницы приложения: окна сообщений отдельно, денежные — прежние", async () => {
    const { take, limits } = setup(mixed);
    await take();
    const report = await limits.getSpending({ userId: "anna" });
    expect(report.windows!.map((window) => window.id)).toEqual(["money"]);
    expect(report.messageWindows).toEqual([
      { id: "day", scope: "user", period: "day", limit: 2, used: 1, remaining: 1, share: 0.5, state: "ok", start: "2026-10-07T00:00:00.000Z", resetsAt: NEXT_DAY },
    ]);
  });

  it("без окон сообщений статус прежний: у денежных окон нет поля unit", async () => {
    const { windowOf, limits } = setup([{ id: "money", scope: "user", kind: "calendar", unit: "day", limitUsd: 1 }]);
    expect(await windowOf("money")).toEqual({ id: "money", scope: "user", period: "day", state: "ok", share: 0, resetsAt: NEXT_DAY });
    expect(await limits.takeMessage!({ userId: "anna", chatId: "chat-1" })).toBeUndefined();
    expect("messageWindows" in (await limits.getSpending({ userId: "anna" }))).toBe(false);
  });
});

describe("окна сообщений: ошибки настроек при создании", () => {
  it("окно и с limitUsd, и с limitMessages, или без обоих — ошибка", () => {
    expect(() => setup([{ id: "both", scope: "user", kind: "total", limitUsd: 1, limitMessages: 5 }])).toThrow(/both.*limitUsd.*limitMessages|limitUsd.*limitMessages/);
    expect(() => setup([{ id: "none", scope: "user", kind: "total" } as SpendingWindowConfig])).toThrow(/none/);
  });

  it("limitMessages — целое неотрицательное число", () => {
    expect(() => setup([dayOf(2.5)])).toThrow(/limitMessages/);
    expect(() => setup([dayOf(-1)])).toThrow(/limitMessages/);
  });

  it("перенос перерасхода у окна сообщений не бывает — ошибка", () => {
    expect(() => setup([{ ...dayOf(2), carryOverrun: true }])).toThrow(/carryOverrun/);
  });

  it("лимит сообщений без методов состояния в хранилище — ошибка", () => {
    const storage = createInMemoryChatStorage();
    const bare = { ...storage, getSpendingLimitState: undefined, saveSpendingLimitState: undefined } as ChatStorage;
    expect(() => setup([dayOf(2)], {}, bare)).toThrow(/getSpendingLimitState/);
  });
});
