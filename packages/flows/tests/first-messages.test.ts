import { describe, expect, it } from "vitest";
import { DEFAULT_FIRST_MESSAGES, firstMessageSlot, localDay, resolveFirstMessages } from "../src/format";

const rules = DEFAULT_FIRST_MESSAGES;
const MSK = "Europe/Moscow";
/** Москва — UTC+3 круглый год. */
const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);

describe("правила «писать первым»: настройка (В10)", () => {
  it("по умолчанию — тихие часы 21:00–09:00 и не больше 3 в сутки", () => {
    expect(resolveFirstMessages(undefined)).toEqual({ quietHours: { from: "21:00", to: "09:00" }, maxPerDay: 3 });
  });

  it("приложение меняет часы и потолок, своя проверка проходит как есть", () => {
    const canWriteNow = () => true;
    expect(resolveFirstMessages({ maxPerDay: 5, canWriteNow })).toEqual({
      quietHours: { from: "21:00", to: "09:00" },
      maxPerDay: 5,
      canWriteNow,
    });
  });

  it("`false` — правила выключены, агент пишет первым без ограничений", () => {
    expect(resolveFirstMessages(false)).toBeNull();
  });

  it("часы не в виде «ЧЧ:ММ» — ошибка настройки", () => {
    expect(() => resolveFirstMessages({ quietHours: { from: "9 вечера", to: "09:00" } })).toThrow(/ЧЧ:ММ/);
  });
});

describe("правила «писать первым»: срок", () => {
  it("днём можно", () => {
    expect(firstMessageSlot(rules, { at: msk(13, 10), timeZone: MSK, sentToday: 0 })).toEqual({ allowed: true });
    expect(firstMessageSlot(rules, { at: msk(13, 9), timeZone: MSK, sentToday: 2 })).toEqual({ allowed: true });
  });

  it("23:40 → 09:00 следующего дня", () => {
    expect(firstMessageSlot(rules, { at: msk(13, 23, 40), timeZone: MSK, sentToday: 0 })).toEqual({
      allowed: false,
      retryAt: msk(14, 9),
    });
  });

  it("ровно 21:00 — уже тихо, 08:59 — ещё тихо до 09:00 того же дня", () => {
    expect(firstMessageSlot(rules, { at: msk(13, 21), timeZone: MSK, sentToday: 0 })).toEqual({ allowed: false, retryAt: msk(14, 9) });
    expect(firstMessageSlot(rules, { at: msk(13, 8, 59), timeZone: MSK, sentToday: 0 })).toEqual({ allowed: false, retryAt: msk(13, 9) });
  });

  it("четвёртое за день → завтра 09:00", () => {
    expect(firstMessageSlot(rules, { at: msk(13, 15), timeZone: MSK, sentToday: 3 })).toEqual({ allowed: false, retryAt: msk(14, 9) });
    // Ночью после полуночи счёт уже за новый день: потолок исчерпан — значит, послезавтра.
    expect(firstMessageSlot(rules, { at: msk(14, 1), timeZone: MSK, sentToday: 3 })).toEqual({ allowed: false, retryAt: msk(15, 9) });
  });

  it("пояса через полночь: один миг — у каждого человека своё время", () => {
    const at = Date.UTC(2026, 9, 13, 20, 30);
    // Москва 23:30 — тихо до 09:00 14-го.
    expect(firstMessageSlot(rules, { at, timeZone: MSK, sentToday: 0 })).toEqual({ allowed: false, retryAt: msk(14, 9) });
    // Бали 04:30 уже 14-го — тихо до 09:00 того же 14-го (01:00 UTC).
    expect(firstMessageSlot(rules, { at, timeZone: "Asia/Makassar", sentToday: 0 })).toEqual({
      allowed: false,
      retryAt: Date.UTC(2026, 9, 14, 1, 0),
    });
    // Лос-Анджелес 13:30 — можно.
    expect(firstMessageSlot(rules, { at, timeZone: "America/Los_Angeles", sentToday: 0 })).toEqual({ allowed: true });
  });

  it("перевод часов: тихие часы кончаются в 09:00 по новому времени", () => {
    // 31.10.2026 23:00 в Лос-Анджелесе (летнее время), а 1.11 в 2:00 часы переводятся назад.
    const at = Date.UTC(2026, 10, 1, 6, 0);
    expect(firstMessageSlot(rules, { at, timeZone: "America/Los_Angeles", sentToday: 0 })).toEqual({
      allowed: false,
      retryAt: Date.UTC(2026, 10, 1, 17, 0),
    });
  });

  it("тихие часы внутри дня и пустые тихие часы", () => {
    const lunch = { quietHours: { from: "13:00", to: "15:00" }, maxPerDay: 3 };
    expect(firstMessageSlot(lunch, { at: msk(13, 14), timeZone: MSK, sentToday: 0 })).toEqual({ allowed: false, retryAt: msk(13, 15) });
    expect(firstMessageSlot(lunch, { at: msk(13, 23), timeZone: MSK, sentToday: 0 })).toEqual({ allowed: true });
    // Потолок: завтра с полуночи, там не тихо.
    expect(firstMessageSlot(lunch, { at: msk(13, 16), timeZone: MSK, sentToday: 3 })).toEqual({ allowed: false, retryAt: msk(14, 0) });
    const never = { quietHours: { from: "00:00", to: "00:00" }, maxPerDay: 3 };
    expect(firstMessageSlot(never, { at: msk(13, 3), timeZone: MSK, sentToday: 0 })).toEqual({ allowed: true });
  });

  it("сутки человека — по его поясу", () => {
    const at = Date.UTC(2026, 9, 13, 20, 30);
    expect(localDay(at, MSK)).toBe("2026-10-13");
    expect(localDay(at, "Asia/Makassar")).toBe("2026-10-14");
  });
});
