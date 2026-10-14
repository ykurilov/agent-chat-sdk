import { describe, expect, it, vi } from "vitest";
import { localDay } from "../../src/format";
import { createChatTimeZones, createFirstMessageRules, pageTimeZone, serverTimeZone, UNKNOWN_TIME_ZONE } from "../../src/runtime/first-message-rules";
import { memoryFlowStore } from "../../src/store/memory";

// T072: правила «писать первым» на хранилище счётчиков и пояс человека (→ В10).

const MSK = "Europe/Moscow";
/** 13.10.2026 в Москве, ЧЧ:ММ. */
const msk = (hours: number, minutes = 0, day = 13) => Date.UTC(2026, 9, day, hours - 3, minutes);
const anna = { ownerId: "anna", chatId: "c1", timeZone: MSK };

describe("T072 правила «писать первым»", () => {
  it("по умолчанию: днём можно; в 23:40 — перенос на 09:00 утра", async () => {
    const rules = createFirstMessageRules(undefined, memoryFlowStore())!;
    expect(await rules.check({ ...anna, at: msk(15) })).toEqual({ allowed: true });
    expect(await rules.check({ ...anna, at: msk(23, 40) })).toEqual({ allowed: false, retryAt: msk(9, 0, 14) });
  });

  it("не больше 3 в сутки человека: четвёртое — завтра в 09:00; счёт по человеку, а не по чату", async () => {
    const store = memoryFlowStore();
    const rules = createFirstMessageRules(undefined, store)!;
    for (const hours of [10, 12, 14]) await rules.record({ ownerId: "anna", at: msk(hours), timeZone: MSK });
    expect(await store.countFirstMessages("anna", localDay(msk(14), MSK))).toBe(3);
    expect(await rules.check({ ...anna, chatId: "другой чат", at: msk(16) })).toEqual({ allowed: false, retryAt: msk(9, 0, 14) });
    expect(await rules.check({ ...anna, ownerId: "boris", at: msk(16) })).toEqual({ allowed: true });
    // Сутки — по часам человека: 01:00 по Москве ещё 13-е по UTC, но уже новые сутки (и пока тихие часы).
    expect(await rules.check({ ...anna, at: msk(1, 0, 14) })).toEqual({ allowed: false, retryAt: msk(9, 0, 14) });
    expect(await rules.check({ ...anna, at: msk(9, 30, 14) })).toEqual({ allowed: true });
  });

  it("настройка приложения: свои тихие часы и потолок", async () => {
    const rules = createFirstMessageRules({ quietHours: { from: "22:00", to: "08:00" }, maxPerDay: 1 }, memoryFlowStore())!;
    expect(await rules.check({ ...anna, at: msk(21, 30) })).toEqual({ allowed: true });
    expect(await rules.check({ ...anna, at: msk(7) })).toEqual({ allowed: false, retryAt: msk(8) });
    await rules.record({ ownerId: "anna", at: msk(10), timeZone: MSK });
    expect(await rules.check({ ...anna, at: msk(11) })).toEqual({ allowed: false, retryAt: msk(8, 0, 14) });
  });

  it("canWriteNow приложения: «нет» — не сейчас, повтор через час; { retryAt } — в названный момент; зовётся только днём, с чатом и временем", async () => {
    const canWriteNow = vi.fn(async ({ chatId }: { ownerId: string; chatId: string; at: Date }) =>
      chatId === "отписался" ? false : chatId === "стоп" ? { retryAt: new Date(msk(18)) } : true,
    );
    const rules = createFirstMessageRules({ canWriteNow }, memoryFlowStore())!;
    expect(await rules.check({ ...anna, chatId: "отписался", at: msk(15) })).toEqual({ allowed: false, retryAt: msk(16) });
    expect(await rules.check({ ...anna, chatId: "стоп", at: msk(15) })).toEqual({ allowed: false, retryAt: msk(18) });
    expect(await rules.check({ ...anna, at: msk(15) })).toEqual({ allowed: true });
    expect(canWriteNow).toHaveBeenCalledWith({ ownerId: "anna", chatId: "c1", at: new Date(msk(15)) });
    canWriteNow.mockClear();
    await rules.check({ ...anna, at: msk(23) });
    expect(canWriteNow).not.toHaveBeenCalled();
  });

  it("false — правил нет, пишет без ограничений: null", () => {
    expect(createFirstMessageRules(false, memoryFlowStore())).toBeNull();
  });

  it("тихие часы с ошибкой — ошибка при создании", () => {
    expect(() => createFirstMessageRules({ quietHours: { from: "9 вечера", to: "09:00" } }, memoryFlowStore())).toThrow(/ЧЧ:ММ/);
  });
});

describe("T072 пояс человека: страница → пояс приложения → пояс сервера", () => {
  it("пояс хода — со страницы, только если он не совпадает с запасным (приложения или сервера)", () => {
    expect(pageTimeZone("Asia/Makassar", MSK)).toBe("Asia/Makassar");
    expect(pageTimeZone(MSK, MSK)).toBeNull();
    expect(pageTimeZone(serverTimeZone(), undefined)).toBeNull();
    // Ядро 0.53 говорит прямо: пояс страницы, совпавший с поясом службы, — всё равно пояс страницы.
    expect(pageTimeZone(MSK, MSK, MSK)).toBe(MSK);
    expect(pageTimeZone("Asia/Makassar", MSK, null)).toBeNull();
  });

  it("известный пояс чата главнее; нет — пояс приложения; нет и его — пояс сервера и предупреждение один раз на чат", () => {
    const warn = vi.fn<(message: string) => void>();
    const withApp = createChatTimeZones({ appTimeZone: () => MSK, warn });
    expect(withApp.of("c1", "Asia/Makassar")).toBe("Asia/Makassar");
    expect(withApp.of("c1", UNKNOWN_TIME_ZONE)).toBe(MSK);
    expect(warn).not.toHaveBeenCalled();

    const bare = createChatTimeZones({ appTimeZone: () => undefined, warn });
    expect(bare.of("c1", UNKNOWN_TIME_ZONE)).toBe(serverTimeZone());
    expect(bare.of("c1", UNKNOWN_TIME_ZONE)).toBe(serverTimeZone());
    expect(bare.of("c2", UNKNOWN_TIME_ZONE)).toBe(serverTimeZone());
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toMatch(/c1.*пояс/);
  });
});
