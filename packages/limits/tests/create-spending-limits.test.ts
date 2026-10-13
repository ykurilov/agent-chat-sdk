import { SpendingLimitReachedError, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ModelProfile, UsageRecord } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createSpendingLimits } from "../src/create-spending-limits";
import type { SpendingLimitsOptions } from "../src/create-spending-limits";

/** Модель с круглой ценой — 1 $ за миллион токенов входа и выхода: сумма в долларах равна числу токенов в миллионах. */
const flatModel: ModelProfile = {
  id: "flat-model",
  displayName: "Flat",
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true },
  providerModelIds: { openrouter: "flat/model" },
  pricing: { openrouter: { inputPerMillion: 1, outputPerMillion: 1 } },
};
const catalogWithFlatModel = extendCatalog(standardCatalog, { addModels: [flatModel] });
const MODEL = { modelId: "flat-model", providerId: "openrouter" };

let recordNumber = 0;
async function spend(storage: ChatStorage, fields: Partial<UsageRecord> & { usd?: number }) {
  const { usd = 0, ...rest } = fields;
  await storage.insertUsageRecord({
    id: `r${++recordNumber}`,
    ownerId: "anna",
    chatId: "chat-1",
    messageId: null,
    source: "answer",
    ...MODEL,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: Math.round(usd * 1_000_000),
    reasoningTokens: 0,
    costUsd: usd,
    createdAt: "2026-10-10T12:00:00.000Z",
    ...rest,
  });
}

function setup(extra: Partial<SpendingLimitsOptions> = {}, nowIso = "2026-10-15T12:00:00.000Z") {
  const storage = createInMemoryChatStorage();
  const clock = { now: new Date(nowIso) };
  const logError = vi.fn();
  const limits = createSpendingLimits({
    storage,
    catalog: catalogWithFlatModel,
    budget: () => ({ user: 5 }),
    now: () => clock.now,
    logError,
    ...extra,
  });
  return { storage, limits, clock, logError };
}

const check = (limits: ReturnType<typeof setup>["limits"], userId = "anna", chatId = "chat-1") => limits.assertWithinLimit({ userId, chatId });

describe("createSpendingLimits: создание", () => {
  it("стандартный каталог принимается: у всех пар есть цена", () => {
    expect(() => setup()).not.toThrow();
  });

  it("модель без цены у провайдера — ошибка со списком пар «модель × провайдер»", () => {
    const unpriced: ModelProfile = {
      id: "acme-1",
      displayName: "Acme",
      contextWindowTokens: 1000,
      acceptsImages: false,
      reasoning: { replayPastTurns: true },
      providerModelIds: { openrouter: "acme/one", fireworks: "acme-one" },
      pricing: { openrouter: { inputPerMillion: 1, outputPerMillion: 2 } },
    };
    const catalog = extendCatalog(catalogWithFlatModel, { addModels: [unpriced] });
    expect(() => setup({ catalog })).toThrow(/acme-1 × fireworks/);
    expect(() => setup({ catalog })).not.toThrow(/acme-1 × openrouter/);
  });

  it("режим ignore принимает такой каталог и один раз предупреждает при создании, какие пары считаться не будут", () => {
    const unpriced: ModelProfile = {
      id: "acme-1",
      displayName: "Acme",
      contextWindowTokens: 1000,
      acceptsImages: false,
      reasoning: { replayPastTurns: true },
      providerModelIds: { openrouter: "acme/one" },
    };
    const catalog = extendCatalog(catalogWithFlatModel, { addModels: [unpriced] });
    const { logError } = setup({ catalog, unpricedModels: "ignore" });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toMatch(/acme-1 × openrouter/);
  });

  it("режим ignore: ход такой модели записан с нулевой стоимостью и лимит не задевает", async () => {
    const unpriced: ModelProfile = {
      id: "acme-1",
      displayName: "Acme",
      contextWindowTokens: 1000,
      acceptsImages: false,
      reasoning: { replayPastTurns: true },
      providerModelIds: { openrouter: "acme/one" },
    };
    const catalog = extendCatalog(catalogWithFlatModel, { addModels: [unpriced] });
    const { storage, limits } = setup({ catalog, unpricedModels: "ignore" });
    await spend(storage, { modelId: "acme-1", providerId: "openrouter", outputTokens: 50_000_000, costUsd: 0 });
    await expect(check(limits)).resolves.toBeUndefined();
    expect((await limits.getSpending({ userId: "anna" })).user.spentUsd).toBe(0);
  });

  it("расход модели, убранной из каталога, остаётся в лимите: деньги взяты из записи, а не из текущих цен", async () => {
    const { storage, limits } = setup();
    await spend(storage, { modelId: "removed-model", providerId: "openrouter", usd: 6 });
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
    expect((await limits.getSpending({ userId: "anna" })).user.spentUsd).toBeCloseTo(6, 9);
  });

  it("смена цены в каталоге не пересчитывает прошлые ходы", async () => {
    const dearer = extendCatalog(catalogWithFlatModel, {
      addModels: [{ ...flatModel, id: "flat-model", pricing: { openrouter: { inputPerMillion: 100, outputPerMillion: 100 } } }],
    });
    const { storage, limits } = setup({ catalog: dearer });
    await spend(storage, { usd: 1 });
    expect((await limits.getSpending({ userId: "anna" })).user.spentUsd).toBeCloseTo(1, 9);
  });

  it.each([0, -0.1, 1, 1.5, Number.NaN])("порог предупреждения %s недопустим", (warnAt) => {
    expect(() => setup({ warnAt })).toThrow(/warnAt/);
  });
});

describe("assertWithinLimit: бюджет на человека", () => {
  it("расход ниже бюджета — ход разрешён", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 4.99 });
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("расход равен бюджету — отказ с областью, периодом и временем обновления", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 5 });
    const failure = await check(limits).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpendingLimitReachedError);
    expect(failure).toMatchObject({ scope: "user", period: "month", resetsAt: "2026-11-01T00:00:00.000Z" });
  });

  it("расход другого человека не в счёт", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 50, ownerId: "boris", chatId: "chat-9" });
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("расход всех чатов человека складывается", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 3, chatId: "chat-1" });
    await spend(storage, { usd: 2, chatId: "chat-2" });
    await expect(check(limits, "anna", "chat-3")).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });

  it("расход прошлого месяца не считается, новый месяц открывает ходы", async () => {
    const { storage, limits, clock } = setup();
    await spend(storage, { usd: 5 });
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
    clock.now = new Date("2026-11-01T00:00:00.000Z");
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("расход в самое начало месяца входит в него", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 5, createdAt: "2026-10-01T00:00:00.000Z" });
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });

  it("суммируются доллары из записей журнала, токены и текущие цены не пересчитываются", async () => {
    const { storage, limits } = setup({ budget: () => ({ user: 0.002 }) });
    const deepseek = { modelId: "deepseek-4.1-flash", providerId: "deepseek", inputTokens: 10_000, cachedInputTokens: 8_000, outputTokens: 500, costUsd: 0.001248 };
    await spend(storage, deepseek);
    await expect(check(limits)).resolves.toBeUndefined();
    await spend(storage, deepseek);
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });

  it("бюджет считается функцией от человека: у разных тарифов разные лимиты", async () => {
    const { storage, limits } = setup({ budget: ({ userId }) => ({ user: userId === "anna" ? 1 : 100 }) });
    await spend(storage, { usd: 2 });
    await spend(storage, { usd: 2, ownerId: "boris", chatId: "chat-9" });
    await expect(check(limits, "anna")).rejects.toBeInstanceOf(SpendingLimitReachedError);
    await expect(check(limits, "boris", "chat-9")).resolves.toBeUndefined();
  });

  it("новый бюджет действует сразу, прошлый расход не пересчитывается", async () => {
    let budget = 1;
    const { storage, limits } = setup({ budget: () => ({ user: budget }) });
    await spend(storage, { usd: 2 });
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
    budget = 10;
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("нет бюджета в ответе функции — человек без лимита, расход не читается", async () => {
    const { storage, limits } = setup({ budget: () => ({}) });
    await spend(storage, { usd: 1000 });
    const read = vi.spyOn(storage, "sumUsage");
    await expect(check(limits)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("нулевой бюджет отказывает с первой попытки", async () => {
    const { limits } = setup({ budget: () => ({ user: 0 }) });
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });

  it("расход удалённого чата остаётся в счёте", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 5, chatId: "chat-that-was-deleted" });
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });
});

describe("assertWithinLimit: бюджет на чат", () => {
  const perChat = { budget: () => ({ user: 100, chat: 1 }) };

  it("чат с исчерпанным бюджетом закрыт, другие чаты человека открыты", async () => {
    const { storage, limits } = setup(perChat);
    await spend(storage, { usd: 1, chatId: "chat-1" });
    const failure = await check(limits, "anna", "chat-1").catch((error: unknown) => error);
    expect(failure).toMatchObject({ scope: "chat", period: "month" });
    await expect(check(limits, "anna", "chat-2")).resolves.toBeUndefined();
  });

  it("исчерпан бюджет человека — закрыты все его чаты", async () => {
    const { storage, limits } = setup({ budget: () => ({ user: 2, chat: 100 }) });
    await spend(storage, { usd: 2, chatId: "chat-1" });
    await expect(check(limits, "anna", "chat-2")).rejects.toMatchObject({ scope: "user" });
  });

  it("исчерпаны оба: отказ называет область, которая закрывает дольше", async () => {
    const { storage, limits } = setup({
      budget: () => ({ user: 1, chat: 1 }),
      period: { user: "day", chat: "month" },
    });
    await spend(storage, { usd: 2 });
    await expect(check(limits)).rejects.toMatchObject({ scope: "chat", period: "month", resetsAt: "2026-11-01T00:00:00.000Z" });
  });

  it("заказанное, но ещё не записанное (pendingUsd) считается потраченным: каждое в своей области", async () => {
    const { storage, limits } = setup({ budget: () => ({ user: 5, chat: 1 }) });
    await spend(storage, { usd: 0.5, chatId: "chat-1" });
    const pending = (user: number, chat: number) => limits.assertWithinLimit({ userId: "anna", chatId: "chat-1", pendingUsd: { user, chat } });
    await expect(pending(0.4, 0.4)).resolves.toBeUndefined();
    await expect(pending(0.5, 0.5)).rejects.toMatchObject({ scope: "chat" });
    // Брони других чатов человека — только в его общий бюджет.
    await expect(pending(4, 0)).resolves.toBeUndefined();
    await expect(pending(4.5, 0)).rejects.toMatchObject({ scope: "user" });
    // Состояние для экрана брони не видит: в нём только записанное.
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toMatchObject({ state: "ok" });
  });

  it("период чата «без периода»: расход копится навсегда, обновления нет", async () => {
    const { storage, limits, clock } = setup({ budget: () => ({ chat: 1 }), period: { chat: "none" } });
    await spend(storage, { usd: 1, createdAt: "2020-01-01T00:00:00.000Z" });
    clock.now = new Date("2030-06-01T00:00:00.000Z");
    await expect(check(limits)).rejects.toMatchObject({ scope: "chat", period: "none", resetsAt: null });
  });
});

describe("периоды", () => {
  it("сутки: расход вчерашнего дня не в счёт", async () => {
    const { storage, limits, clock } = setup({ period: "day" });
    await spend(storage, { usd: 5, createdAt: "2026-10-14T23:59:59.000Z" });
    await expect(check(limits)).resolves.toBeUndefined();
    await spend(storage, { usd: 5, createdAt: "2026-10-15T08:00:00.000Z" });
    await expect(check(limits)).rejects.toMatchObject({ period: "day", resetsAt: "2026-10-16T00:00:00.000Z" });
    clock.now = new Date("2026-10-16T00:00:00.000Z");
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("неделя: с понедельника 00:00, расход воскресенья прошлой недели не в счёт", async () => {
    const { storage, limits, clock } = setup({ period: "week" });
    await spend(storage, { usd: 5, createdAt: "2026-10-11T23:59:59.000Z" }); // воскресенье
    await expect(check(limits)).resolves.toBeUndefined();
    await spend(storage, { usd: 5, createdAt: "2026-10-12T08:00:00.000Z" }); // понедельник
    await expect(check(limits)).rejects.toMatchObject({ period: "week", resetsAt: "2026-10-19T00:00:00.000Z" });
    clock.now = new Date("2026-10-19T00:00:00.000Z");
    await expect(check(limits)).resolves.toBeUndefined();
  });

  it("неделя по поясу лимитов: понедельник начинается в полночь по Москве", async () => {
    const { storage, limits } = setup({ period: "week", timeZone: "Europe/Moscow" });
    await spend(storage, { usd: 5, createdAt: "2026-10-11T21:00:00.000Z" }); // 00:00 МСК понедельника
    await expect(check(limits)).rejects.toMatchObject({ period: "week", resetsAt: "2026-10-18T21:00:00.000Z" });
  });
});

describe("сбои", () => {
  it("функция бюджета упала — ход отклонён, сбой в журнале сервера", async () => {
    const { limits, logError } = setup({
      budget: () => {
        throw new Error("тарифы недоступны");
      },
    });
    await expect(check(limits)).rejects.toThrow("тарифы недоступны");
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/бюджет.*тарифы недоступны/i));
  });

  it("асинхронная функция бюджета тоже работает", async () => {
    const { storage, limits } = setup({ budget: async () => ({ user: 1 }) });
    await spend(storage, { usd: 1 });
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "5" as unknown as number])("недопустимый бюджет %s отклоняет ход", async (bad) => {
    const { limits, logError } = setup({ budget: () => ({ user: bad }) });
    await expect(check(limits)).rejects.toThrow(/бюджет/i);
    expect(logError).toHaveBeenCalled();
  });

  it("сбой чтения расхода отклоняет ход, а не пропускает", async () => {
    const { storage, limits } = setup();
    vi.spyOn(storage, "sumUsage").mockRejectedValue(new Error("база недоступна"));
    await expect(check(limits)).rejects.toThrow("база недоступна");
  });
});

describe("status: состояние для экрана", () => {
  it("ниже порога — ok", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 3 });
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toMatchObject({ state: "ok" });
  });

  it("с 80% — warning с долей и датой обновления, без денег", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 4 });
    const status = await limits.status({ userId: "anna", chatId: "chat-1" });
    expect(status).toEqual({ state: "warning", scope: "user", period: "month", share: 0.8, resetsAt: "2026-11-01T00:00:00.000Z" });
  });

  it("порог настраивается", async () => {
    const { storage, limits } = setup({ warnAt: 0.5 });
    await spend(storage, { usd: 2.6 });
    expect((await limits.status({ userId: "anna", chatId: "chat-1" })).state).toBe("warning");
  });

  it("исчерпано — exhausted", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 6 });
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toMatchObject({ state: "exhausted", share: 1.2 });
  });

  it("из двух областей берётся худшая", async () => {
    const { storage, limits } = setup({ budget: () => ({ user: 100, chat: 1 }) });
    await spend(storage, { usd: 1 });
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toMatchObject({ state: "exhausted", scope: "chat" });
  });

  it("без лимитов — ok без области", async () => {
    const { limits } = setup({ budget: () => ({}) });
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toEqual({ state: "ok" });
  });
});

describe("getSpending: расход для страницы приложения", () => {
  it("по человеку: лимит, потрачено, осталось, доля, состояние, границы периода", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 2 });
    const report = await limits.getSpending({ userId: "anna" });
    expect(report.chat).toBeUndefined();
    expect(report.user).toMatchObject({
      limitUsd: 5,
      remainingUsd: 3,
      share: 0.4,
      state: "ok",
      period: "month",
      periodStart: "2026-10-01T00:00:00.000Z",
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
    expect(report.user.spentUsd).toBeCloseTo(2, 6);
  });

  it("с чатом добавляется расход чата", async () => {
    const { storage, limits } = setup({ budget: () => ({ user: 5, chat: 2 }) });
    await spend(storage, { usd: 1, chatId: "chat-1" });
    await spend(storage, { usd: 1, chatId: "chat-2" });
    const report = await limits.getSpending({ userId: "anna", chatId: "chat-1" });
    expect(report.user.spentUsd).toBeCloseTo(2, 6);
    expect(report.chat).toMatchObject({ limitUsd: 2, state: "ok", share: 0.5 });
    expect(report.chat!.spentUsd).toBeCloseTo(1, 6);
  });

  it("расход чата считается только по записям этого человека: чужой чат с тем же id в него не входит", async () => {
    const { storage, limits } = setup({ budget: () => ({ user: 5, chat: 2 }) });
    await spend(storage, { usd: 1, chatId: "chat-1" });
    await spend(storage, { usd: 1.5, chatId: "chat-1", ownerId: "boris" });
    const report = await limits.getSpending({ userId: "anna", chatId: "chat-1" });
    expect(report.chat!.spentUsd).toBeCloseTo(1, 6);
    expect(report.user.spentUsd).toBeCloseTo(1, 6);
  });

  it("проверка перед ходом тоже считает чат только по записям этого человека", async () => {
    const { storage, limits } = setup({ budget: () => ({ chat: 2 }) });
    await spend(storage, { usd: 3, chatId: "chat-1", ownerId: "boris" });
    await expect(check(limits, "anna", "chat-1")).resolves.toBeUndefined();
  });

  it("нет лимита — limitUsd null, расход виден", async () => {
    const { storage, limits } = setup({ budget: () => ({}) });
    await spend(storage, { usd: 1 });
    const report = await limits.getSpending({ userId: "anna" });
    expect(report.user).toMatchObject({ limitUsd: null, remainingUsd: null, share: null, state: "ok" });
    expect(report.user.spentUsd).toBeCloseTo(1, 6);
  });

  it("перерасход: осталось ноль, а не минус", async () => {
    const { storage, limits } = setup();
    await spend(storage, { usd: 6 });
    expect((await limits.getSpending({ userId: "anna" })).user).toMatchObject({ remainingUsd: 0, state: "exhausted" });
  });

  it("данные из базы, а не из памяти: другой экземпляр видит тот же расход", async () => {
    const { storage, limits } = setup();
    const other = createSpendingLimits({ storage, catalog: catalogWithFlatModel, budget: () => ({ user: 5 }), now: () => new Date("2026-10-15T12:00:00.000Z") });
    await spend(storage, { usd: 5 });
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);
    await expect(other.assertWithinLimit({ userId: "anna", chatId: "chat-1" })).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });
});

describe("createSpendingLimits: часовой пояс", () => {
  it("без пояса — сутки по UTC, как раньше; пояса в ответах нет", async () => {
    const { limits } = setup({ period: "day" }, "2026-10-03T23:59:00.000Z");
    const report = await limits.getSpending({ userId: "anna" });
    expect(report.user.periodStart).toBe("2026-10-03T00:00:00.000Z");
    expect(report.user.resetsAt).toBe("2026-10-04T00:00:00.000Z");
    expect(report.timeZone).toBeUndefined();
    expect(limits.timeZone).toBeUndefined();
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toEqual({ state: "ok", scope: "user", period: "day", share: 0, resetsAt: "2026-10-04T00:00:00.000Z" });
  });

  it("Europe/Moscow: расход до полуночи по Москве не входит в новые сутки, а в 03:00 по Москве ничего не обнуляется", async () => {
    const { storage, limits, clock } = setup({ period: "day", timeZone: "Europe/Moscow" }, "2026-10-03T20:59:00.000Z");
    expect(limits.timeZone).toBe("Europe/Moscow");
    await spend(storage, { usd: 5, createdAt: "2026-10-03T20:58:00.000Z" }); // 23:58 МСК 3 октября
    await expect(check(limits)).rejects.toBeInstanceOf(SpendingLimitReachedError);

    clock.now = new Date("2026-10-03T21:01:00.000Z"); // 00:01 МСК 4 октября — новые сутки
    await expect(check(limits)).resolves.toBeUndefined();

    await spend(storage, { usd: 5, createdAt: "2026-10-03T23:59:00.000Z" }); // 02:59 МСК
    clock.now = new Date("2026-10-04T00:01:00.000Z"); // 03:01 МСК — те же сутки, лимит стоит
    const refusal = await check(limits).catch((failure: unknown) => failure);
    expect(refusal).toBeInstanceOf(SpendingLimitReachedError);
    expect(refusal).toMatchObject({ resetsAt: "2026-10-04T21:00:00.000Z", timeZone: "Europe/Moscow" });
  });

  it("пояс уходит в состояние лимита и в отчёт: экран показывает дату обновления по нему", async () => {
    const { limits } = setup({ period: "day", timeZone: "Europe/Moscow" }, "2026-10-03T12:00:00.000Z");
    expect(await limits.status({ userId: "anna", chatId: "chat-1" })).toMatchObject({ resetsAt: "2026-10-03T21:00:00.000Z", timeZone: "Europe/Moscow" });
    expect((await limits.getSpending({ userId: "anna" })).timeZone).toBe("Europe/Moscow");
  });

  it("не IANA-пояс — понятная ошибка при создании", () => {
    expect(() => setup({ timeZone: "Moscow" })).toThrow(/timeZone.*Europe\/Moscow/);
    expect(() => setup({ timeZone: "+03:00" })).toThrow(/timeZone/);
    expect(() => setup({ timeZone: "Mars/Olympus" })).toThrow(/Mars\/Olympus/);
  });
});
