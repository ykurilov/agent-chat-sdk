import { SpendingLimitReachedError, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ModelProfile, UsageRecord } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
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

let recordNumber = 0;
async function spend(storage: ChatStorage, usd: number, createdAt: string, fields: Partial<UsageRecord> = {}) {
  await storage.insertUsageRecord({
    id: `w${++recordNumber}`,
    ownerId: "anna",
    chatId: "chat-1",
    messageId: null,
    source: "answer",
    modelId: "flat-model",
    providerId: "openrouter",
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: Math.round(usd * 1_000_000),
    reasoningTokens: 0,
    costUsd: usd,
    createdAt,
    ...fields,
  });
}

// Пример из задачи: окно 5 часов — 0,30 $, неделя с понедельника по Москве — 1 $, весь сервис — 20 $ в день.
const exampleWindows: SpendingWindowConfig[] = [
  { id: "5h", scope: "user", kind: "rolling", hours: 5, limitUsd: 0.3 },
  { id: "week", scope: "user", kind: "calendar", unit: "week", timeZone: "Europe/Moscow", weekStartsOn: 1, limitUsd: 1 },
  { id: "service-day", scope: "service", kind: "calendar", unit: "day", limitUsd: 20 },
];

// Среда, 7 октября 2026, 12:00 UTC (15:00 по Москве). Неделя по Москве началась в понедельник 5-го в 00:00 MSK.
const WEDNESDAY = "2026-10-07T12:00:00.000Z";
const WEEK_START = "2026-10-04T21:00:00.000Z";
const NEXT_WEEK = "2026-10-11T21:00:00.000Z";

function setup(extra: Partial<SpendingLimitsOptions> = {}, nowIso = WEDNESDAY) {
  const storage = createInMemoryChatStorage();
  const clock = { now: new Date(nowIso) };
  const logError = vi.fn();
  const limits = createSpendingLimits({ storage, catalog, windows: exampleWindows, now: () => clock.now, logError, ...extra });
  const at = (iso: string) => (clock.now = new Date(iso));
  const later = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
  return { storage, limits, clock, at, later, logError };
}

const HOUR = 3_600_000;
const check = (limits: ReturnType<typeof setup>["limits"], userId = "anna", chatId = "chat-1") => limits.assertWithinLimit({ userId, chatId });
const windowOf = async (limits: ReturnType<typeof setup>["limits"], id: string, userId = "anna") =>
  (await limits.status({ userId, chatId: "chat-1" })).windows!.find((window) => window.id === id)!;

describe("окна лимитов: скользящее окно «N часов от первого запроса»", () => {
  it("до первого запроса окно не идёт: доля 0, сброса нет; status окно не открывает", async () => {
    const { limits } = setup();
    expect(await windowOf(limits, "5h")).toEqual({ id: "5h", scope: "user", period: "rolling", hours: 5, state: "ok", share: 0, resetsAt: null });
  });

  it("первый запрос открывает окно на 5 часов: расход в нём считается, сброс — через 5 часов от запроса", async () => {
    const { limits, storage, later } = setup();
    await check(limits);
    await spend(storage, 0.15, WEDNESDAY);
    later(HOUR);
    expect(await windowOf(limits, "5h")).toMatchObject({ share: 0.5, resetsAt: "2026-10-07T17:00:00.000Z" });
  });

  it("окно кончилось — расход прошлого окна не считается; новое окно — от следующего запроса, а не от конца прошлого", async () => {
    const { limits, storage, at } = setup();
    await check(limits);
    await spend(storage, 0.3, WEDNESDAY);
    await expect(check(limits)).rejects.toMatchObject({ scope: "user", period: "rolling", hours: 5, windowId: "5h", resetsAt: "2026-10-07T17:00:00.000Z" });
    at("2026-10-07T19:30:00.000Z");
    expect(await windowOf(limits, "5h")).toMatchObject({ share: 0, resetsAt: null });
    await check(limits);
    expect(await windowOf(limits, "5h")).toMatchObject({ share: 0, resetsAt: "2026-10-08T00:30:00.000Z" });
  });

  it("отказ по другому окну окно не открывает", async () => {
    const { limits, storage } = setup();
    await spend(storage, 1, "2026-10-06T10:00:00.000Z");
    await expect(check(limits)).rejects.toMatchObject({ windowId: "week" });
    expect(await windowOf(limits, "5h")).toMatchObject({ resetsAt: null });
  });

  it("без методов состояния у хранилища скользящее окно — ошибка при создании", () => {
    const storage = createInMemoryChatStorage();
    const bare: ChatStorage = { ...storage, getSpendingLimitState: undefined, saveSpendingLimitState: undefined };
    expect(() => createSpendingLimits({ storage: bare, catalog, windows: exampleWindows })).toThrow(/getSpendingLimitState/);
  });
});

describe("окна лимитов: календарная неделя по поясу", () => {
  it("неделя с понедельника по Москве: воскресенье 23:00 MSK — прошлая неделя; сброс — в следующий понедельник 00:00 MSK", async () => {
    const { limits, storage } = setup();
    await spend(storage, 0.5, "2026-10-04T20:00:00.000Z"); // воскресенье 23:00 MSK
    await spend(storage, 0.25, WEEK_START); // понедельник 00:00 MSK
    expect(await windowOf(limits, "week")).toEqual({ id: "week", scope: "user", period: "week", state: "ok", share: 0.25, resetsAt: NEXT_WEEK });
  });

  it("неделя с воскресенья (weekStartsOn: 7)", async () => {
    const { limits } = setup({
      windows: [{ id: "week", scope: "user", kind: "calendar", unit: "week", timeZone: "Europe/Moscow", weekStartsOn: 7, limitUsd: 1 }],
    });
    expect(await windowOf(limits, "week")).toMatchObject({ resetsAt: "2026-10-10T21:00:00.000Z" });
  });

  it("месяц и сутки по поясу окна; без пояса — по поясу лимитов", async () => {
    const { limits } = setup({
      timeZone: "Asia/Tokyo",
      windows: [
        { id: "month", scope: "user", kind: "calendar", unit: "month", timeZone: "Europe/Moscow", limitUsd: 10 },
        { id: "day", scope: "user", kind: "calendar", unit: "day", limitUsd: 1 },
      ],
    });
    expect(await windowOf(limits, "month")).toMatchObject({ resetsAt: "2026-10-31T21:00:00.000Z" });
    expect(await windowOf(limits, "day")).toMatchObject({ resetsAt: "2026-10-07T15:00:00.000Z" });
  });
});

describe("окна лимитов: области", () => {
  it("весь сервис: расход всех людей вместе; исчерпан — отказ всем с областью service", async () => {
    const { limits, storage } = setup();
    await spend(storage, 12, "2026-10-07T01:00:00.000Z", { ownerId: "boris", chatId: "chat-b" });
    await spend(storage, 8, "2026-10-07T02:00:00.000Z", { ownerId: "clara", chatId: "chat-c" });
    const refusal = await check(limits).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SpendingLimitReachedError);
    expect(refusal).toMatchObject({ scope: "service", period: "day", windowId: "service-day", reason: "limit", resetsAt: "2026-10-08T00:00:00.000Z" });
  });

  it("окно чата считает только этот чат", async () => {
    const { limits, storage } = setup({ windows: [{ id: "chat-day", scope: "chat", kind: "calendar", unit: "day", limitUsd: 1 }] });
    await spend(storage, 0.9, WEDNESDAY, { chatId: "chat-2" });
    await spend(storage, 0.5, WEDNESDAY);
    expect(await windowOf(limits, "chat-day")).toMatchObject({ scope: "chat", share: 0.5 });
  });

  it("лимит — функция от человека и чата: у тарифов разные лимиты; undefined — у этого человека окна нет", async () => {
    const { limits } = setup({
      windows: [{ id: "day", scope: "user", kind: "calendar", unit: "day", limitUsd: ({ userId }) => (userId === "vip" ? undefined : 1) }],
    });
    expect((await limits.status({ userId: "anna", chatId: "c" })).windows).toHaveLength(1);
    expect((await limits.status({ userId: "vip", chatId: "c" })).windows).toEqual([]);
  });
});

describe("окна лимитов: для браузера — только доли и время сброса", () => {
  it("status: самое тесное окно наверху и все окна списком, без долларов", async () => {
    const { limits, storage } = setup();
    await check(limits);
    await spend(storage, 0.27, WEDNESDAY);
    const status = await limits.status({ userId: "anna", chatId: "chat-1" });
    expect(status).toMatchObject({ state: "warning", scope: "user", period: "rolling", hours: 5, windowId: "5h", share: 0.9 });
    expect(status.windows!.map((window) => window.id)).toEqual(["5h", "week", "service-day"]);
    expect(JSON.stringify(status)).not.toMatch(/usd|Usd|spent|limit/);
  });

  it("getSpending — для страницы приложения: доллары по каждому окну", async () => {
    const { limits, storage } = setup();
    await spend(storage, 0.4, "2026-10-06T10:00:00.000Z");
    const report = await limits.getSpending({ userId: "anna" });
    expect(report.windows!.find((window) => window.id === "week")).toMatchObject({
      limitUsd: 1, spentUsd: 0.4, remainingUsd: 0.6, share: 0.4, state: "ok", start: WEEK_START, resetsAt: NEXT_WEEK, carriedUsd: 0,
    });
  });
});

describe("правила хода", () => {
  it("запас на старт: остаток меньше запаса — отказ с причиной reserve; хватает — ход идёт", async () => {
    const { limits, storage } = setup({ turn: { minRemainingUsd: 0.03 } });
    await check(limits);
    await spend(storage, 0.28, WEDNESDAY);
    await expect(check(limits)).rejects.toMatchObject({ reason: "reserve", windowId: "5h" });
    // Экран тоже не пускает в заведомо отказной ход.
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toMatchObject({ state: "exhausted", reason: "reserve", windowId: "5h" });
    const roomy = setup({ turn: { minRemainingUsd: 0.03 } });
    await check(roomy.limits);
    await spend(roomy.storage, 0.26, WEDNESDAY);
    await expect(check(roomy.limits)).resolves.toBeUndefined();
  });

  it("потолки хода: деньги и вызовы из настроек; overrun «finish» (по умолчанию) — остаток окна потолок не режет", async () => {
    const { limits, storage } = setup({ turn: { maxCostUsd: 0.1, maxToolCalls: 40 } });
    await check(limits);
    await spend(storage, 0.25, WEDNESDAY);
    expect(await limits.turnRules!({ userId: "anna", chatId: "chat-1" })).toEqual({ maxCostUsd: 0.1, maxToolCalls: 40 });
  });

  it("overrun «stop»: потолок денег хода — не больше остатка самого тесного окна", async () => {
    const { limits, storage } = setup({ turn: { maxCostUsd: 0.1, overrun: "stop" } });
    await check(limits);
    await spend(storage, 0.25, WEDNESDAY);
    const rules = await limits.turnRules!({ userId: "anna", chatId: "chat-1" });
    expect(rules!.maxCostUsd).toBeCloseTo(0.05, 9);
  });

  it("перенос перерасхода: перерасход окна идёт в начало следующего", async () => {
    const windows: SpendingWindowConfig[] = [{ id: "5h", scope: "user", kind: "rolling", hours: 5, limitUsd: 0.3, carryOverrun: true }];
    const { limits, storage, at } = setup({ windows });
    await check(limits);
    await spend(storage, 0.45, WEDNESDAY); // ход доделан сверх лимита на 0,15
    at("2026-10-07T18:00:00.000Z");
    await check(limits);
    expect(await windowOf(limits, "5h")).toMatchObject({ share: 0.5 });
    expect((await limits.getSpending({ userId: "anna" })).windows![0]).toMatchObject({
      carriedUsd: expect.closeTo(0.15, 9),
      spentUsd: expect.closeTo(0.15, 9),
    });
  });

  it("долг больше лимита: отказ всё равно открывает скользящее окно — долг гасится окнами, а не держит человека вечно", async () => {
    const windows: SpendingWindowConfig[] = [{ id: "5h", scope: "user", kind: "rolling", hours: 5, limitUsd: 0.5, carryOverrun: true }];
    const { limits, storage, at } = setup({ windows });
    await check(limits);
    await spend(storage, 1.2, WEDNESDAY); // долг 0,7 — больше лимита окна
    at("2026-10-07T18:00:00.000Z");
    await expect(check(limits)).rejects.toMatchObject({ windowId: "5h", resetsAt: "2026-10-07T23:00:00.000Z" });
    at("2026-10-07T20:00:00.000Z");
    // Окно открыто первым отказом: сброс не уезжает вперёд.
    await expect(check(limits)).rejects.toMatchObject({ windowId: "5h", resetsAt: "2026-10-07T23:00:00.000Z" });
    at("2026-10-08T00:00:00.000Z");
    // Окно с долгом 0,7 кончилось: в следующее идёт 0,2 — меньше лимита, ход можно.
    await expect(check(limits)).resolves.toBeUndefined();
    expect((await limits.getSpending({ userId: "anna" })).windows![0]!.carriedUsd).toBeCloseTo(0.2, 9);
  });

  it("перенос в календарном окне: прошлая неделя ушла в минус — новая неделя начинается с этого минуса", async () => {
    const windows: SpendingWindowConfig[] = [{ id: "week", scope: "user", kind: "calendar", unit: "week", timeZone: "Europe/Moscow", limitUsd: 1, carryOverrun: true }];
    const { limits, storage, at } = setup({ windows }, "2026-10-02T12:00:00.000Z");
    await spend(storage, 1.4, "2026-10-02T10:00:00.000Z");
    expect(await windowOf(limits, "week")).toMatchObject({ state: "exhausted" });
    at(WEDNESDAY);
    expect(await windowOf(limits, "week")).toMatchObject({ share: 0.4 });
  });

  it("без переноса перерасход в новое окно не идёт", async () => {
    const { limits, storage, at } = setup();
    await check(limits);
    await spend(storage, 0.45, WEDNESDAY);
    at("2026-10-07T18:00:00.000Z");
    await check(limits);
    expect(await windowOf(limits, "5h")).toMatchObject({ share: 0 });
  });
});

describe("настройки конкретного человека", () => {
  it("свой лимит окна; null — без лимита; «default» — снова общий", async () => {
    const { limits, storage } = setup();
    await spend(storage, 0.5, "2026-10-06T10:00:00.000Z");
    await limits.setUserSettings("anna", { limits: { week: 5 } });
    expect(await windowOf(limits, "week")).toMatchObject({ share: 0.1 });
    await limits.setUserSettings("anna", { limits: { week: null } });
    expect((await limits.status({ userId: "anna", chatId: "chat-1" })).windows!.map((window) => window.id)).not.toContain("week");
    await limits.setUserSettings("anna", { limits: { week: "default" } });
    expect(await windowOf(limits, "week")).toMatchObject({ share: 0.5 });
    expect(await limits.getUserSettings("anna")).toEqual({ blocked: false, limits: {} });
    expect(await windowOf(limits, "week", "boris")).toMatchObject({ share: 0 });
  });

  it("блокировка: ход не начинается с причиной blocked, status говорит blocked; снятие — снова можно", async () => {
    const { limits } = setup();
    await limits.setUserSettings("anna", { blocked: true });
    await expect(check(limits)).rejects.toMatchObject({ reason: "blocked", scope: "user", period: "none", resetsAt: null });
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toMatchObject({ state: "exhausted", blocked: true, reason: "blocked" });
    await expect(check(limits, "boris")).resolves.toBeUndefined();
    await limits.setUserSettings("anna", { blocked: false });
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("ручной сброс окна: расход до сброса не считается, перенос стирается; другие окна не трогает", async () => {
    const { limits, storage, later } = setup();
    await check(limits);
    await spend(storage, 0.3, WEDNESDAY);
    later(60_000);
    await limits.resetWindow({ windowId: "5h", userId: "anna" });
    expect(await windowOf(limits, "5h")).toMatchObject({ share: 0 });
    expect(await windowOf(limits, "week")).toMatchObject({ share: 0.3 });
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("сброс окна сервиса и окна чата", async () => {
    const windows: SpendingWindowConfig[] = [
      { id: "service-day", scope: "service", kind: "calendar", unit: "day", limitUsd: 1 },
      { id: "chat-day", scope: "chat", kind: "calendar", unit: "day", limitUsd: 1 },
    ];
    const { limits, storage, later } = setup({ windows });
    await spend(storage, 1, WEDNESDAY);
    later(1000);
    await limits.resetWindow({ windowId: "service-day" });
    await limits.resetWindow({ windowId: "chat-day", chatId: "chat-1" });
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("неизвестное окно или не та область — ошибка", async () => {
    const { limits } = setup();
    await expect(limits.resetWindow({ windowId: "nope", userId: "anna" })).rejects.toThrow(/nope/);
    await expect(limits.resetWindow({ windowId: "week" })).rejects.toThrow(/userId/);
    await expect(limits.setUserSettings("anna", { limits: { nope: 1 } })).rejects.toThrow(/nope/);
  });
});

describe("пороги: события на 80% и 100%", () => {
  it("каждый порог окна — одно событие на окно; в новом окне — снова", async () => {
    const onThreshold = vi.fn();
    const { limits, storage, at } = setup({ onThreshold });
    await check(limits);
    await spend(storage, 0.25, WEDNESDAY);
    await limits.afterSpending!({ userId: "anna", chatId: "chat-1" });
    await limits.afterSpending!({ userId: "anna", chatId: "chat-1" });
    expect(onThreshold).toHaveBeenCalledTimes(1);
    expect(onThreshold).toHaveBeenCalledWith(expect.objectContaining({
      windowId: "5h", scope: "user", period: "rolling", threshold: 0.8, userId: "anna", chatId: "chat-1", limitUsd: 0.3, resetsAt: "2026-10-07T17:00:00.000Z",
    }));
    await spend(storage, 0.1, WEDNESDAY);
    await limits.afterSpending!({ userId: "anna", chatId: "chat-1" });
    expect(onThreshold).toHaveBeenLastCalledWith(expect.objectContaining({ windowId: "5h", threshold: 1 }));
    // 80% и 100% окна 5h; неделя — 0,35 из 1, до порога не дошла.
    expect(onThreshold).toHaveBeenCalledTimes(2);
  });

  it("после ручного сброса окна пороги шлются снова", async () => {
    const onThreshold = vi.fn();
    const { limits, storage, later } = setup({ onThreshold, thresholds: [0.5] });
    await spend(storage, 0.6, "2026-10-06T10:00:00.000Z");
    await limits.afterSpending!({ userId: "anna", chatId: "chat-1" });
    expect(onThreshold).toHaveBeenCalledTimes(1);
    await limits.resetWindow({ windowId: "week", userId: "anna" });
    later(1000);
    await spend(storage, 0.6, new Date(Date.parse(WEDNESDAY) + 1000).toISOString());
    await limits.afterSpending!({ userId: "anna", chatId: "chat-1" });
    expect(onThreshold).toHaveBeenCalledTimes(2);
  });

  it("одновременные проверки шлют порог один раз", async () => {
    const onThreshold = vi.fn();
    const { limits, storage } = setup({ onThreshold, thresholds: [0.5] });
    await spend(storage, 0.6, "2026-10-06T10:00:00.000Z");
    await Promise.all(Array.from({ length: 5 }, () => limits.afterSpending!({ userId: "anna", chatId: "chat-1" })));
    expect(onThreshold).toHaveBeenCalledTimes(1);
    expect(onThreshold).toHaveBeenCalledWith(expect.objectContaining({ windowId: "week", threshold: 0.5 }));
  });

  it("сбой обработчика — в журнал сервера, проверка не падает", async () => {
    const { limits, storage, logError } = setup({ onThreshold: () => Promise.reject(new Error("почта легла")), thresholds: [0.5] });
    await spend(storage, 0.6, "2026-10-06T10:00:00.000Z");
    await limits.afterSpending!({ userId: "anna", chatId: "chat-1" });
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining("почта легла")));
  });

  it("неверные пороги — ошибка при создании", () => {
    expect(() => setup({ thresholds: [0] })).toThrow(/thresholds/);
    expect(() => setup({ thresholds: [1.5] })).toThrow(/thresholds/);
  });
});

describe("окна лимитов: проверка настроек", () => {
  it.each([
    ["повтор имени", [exampleWindows[0]!, exampleWindows[0]!], /5h/],
    ["нет часов", [{ id: "r", scope: "user", kind: "rolling", hours: 0, limitUsd: 1 }], /hours/],
    ["день недели", [{ id: "w", scope: "user", kind: "calendar", unit: "week", weekStartsOn: 8, limitUsd: 1 }], /weekStartsOn/],
    ["пояс", [{ id: "d", scope: "user", kind: "calendar", unit: "day", timeZone: "Mars/Base", limitUsd: 1 }], /Mars\/Base/],
    ["отрицательный лимит", [{ id: "d", scope: "user", kind: "calendar", unit: "day", limitUsd: -1 }], /limitUsd/],
  ] as const)("%s — ошибка при создании", (_name, windows, message) => {
    expect(() => setup({ windows: windows as unknown as SpendingWindowConfig[] })).toThrow(message);
  });

  it("с budget свои лимиты окон не задать — ошибка, а не тихое «сохранено, но не действует»; блокировка работает", async () => {
    const legacy = setup({ windows: undefined, budget: () => ({ user: 1 }) });
    await expect(legacy.limits.setUserSettings("anna", { limits: { user: 5 } })).rejects.toThrow(/windows/);
    await legacy.limits.setUserSettings("anna", { blocked: true });
    await expect(check(legacy.limits)).rejects.toMatchObject({ reason: "blocked" });
  });

  it("windows и budget вместе — ошибка: лимиты задаются одним способом", () => {
    expect(() => setup({ budget: () => ({ user: 1 }) })).toThrow(/budget/);
  });
});
