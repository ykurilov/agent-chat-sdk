import { describe, expect, it } from "vitest";
import { periodBounds } from "../src/spending-period";

const at = (iso: string) => new Date(iso);

describe("periodBounds: границы периода по UTC", () => {
  it("месяц: с 1-го числа 00:00 до 1-го числа следующего месяца", () => {
    expect(periodBounds("month", at("2026-10-15T13:45:00.000Z"))).toEqual({
      start: "2026-10-01T00:00:00.000Z",
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
  });

  it("последняя миллисекунда месяца ещё в этом месяце, следующая — уже в новом", () => {
    expect(periodBounds("month", at("2026-10-31T23:59:59.999Z")).start).toBe("2026-10-01T00:00:00.000Z");
    expect(periodBounds("month", at("2026-11-01T00:00:00.000Z")).start).toBe("2026-11-01T00:00:00.000Z");
  });

  it("декабрь переходит на январь следующего года", () => {
    expect(periodBounds("month", at("2026-12-20T00:00:00.000Z")).resetsAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("сутки: с 00:00 до 00:00 следующего дня", () => {
    expect(periodBounds("day", at("2026-02-28T23:00:00.000Z"))).toEqual({
      start: "2026-02-28T00:00:00.000Z",
      resetsAt: "2026-03-01T00:00:00.000Z",
    });
  });

  it("без периода: начала и обновления нет", () => {
    expect(periodBounds("none", at("2026-10-15T00:00:00.000Z"))).toEqual({ start: null, resetsAt: null });
  });
});

describe("periodBounds: границы периода по часовому поясу", () => {
  const moscow = "Europe/Moscow";
  const dayOf = (iso: string, timeZone?: string) => periodBounds("day", at(iso), timeZone).start;

  it("Москва: 23:59 и 00:01 по Москве — разные сутки", () => {
    // 23:59 МСК 3 октября = 20:59 UTC; 00:01 МСК 4 октября = 21:01 UTC.
    expect(dayOf("2026-10-03T20:59:00.000Z", moscow)).toBe("2026-10-02T21:00:00.000Z");
    expect(dayOf("2026-10-03T21:01:00.000Z", moscow)).toBe("2026-10-03T21:00:00.000Z");
  });

  it("Москва: 02:59 и 03:01 по Москве — одни сутки (без пояса здесь была граница UTC)", () => {
    // 02:59 МСК = 23:59 UTC прошлого дня; 03:01 МСК = 00:01 UTC.
    expect(dayOf("2026-10-03T23:59:00.000Z", moscow)).toBe(dayOf("2026-10-04T00:01:00.000Z", moscow));
    expect(dayOf("2026-10-03T23:59:00.000Z")).not.toBe(dayOf("2026-10-04T00:01:00.000Z"));
  });

  it("Москва: сутки обнуляются в полночь по Москве, месяц — с 1-го числа по Москве", () => {
    expect(periodBounds("day", at("2026-10-03T12:00:00.000Z"), moscow)).toEqual({
      start: "2026-10-02T21:00:00.000Z",
      resetsAt: "2026-10-03T21:00:00.000Z",
    });
    expect(periodBounds("month", at("2026-10-31T22:30:00.000Z"), moscow)).toEqual({
      start: "2026-10-31T21:00:00.000Z",
      resetsAt: "2026-11-30T21:00:00.000Z",
    });
  });

  it("переход на летнее время: сутки 23 часа, обратно — 25 часов (Нью-Йорк)", () => {
    const spring = periodBounds("day", at("2026-03-08T15:00:00.000Z"), "America/New_York");
    expect(spring).toEqual({ start: "2026-03-08T05:00:00.000Z", resetsAt: "2026-03-09T04:00:00.000Z" });
    const autumn = periodBounds("day", at("2026-11-01T15:00:00.000Z"), "America/New_York");
    expect(autumn).toEqual({ start: "2026-11-01T04:00:00.000Z", resetsAt: "2026-11-02T05:00:00.000Z" });
  });

  it("месяц через переход на летнее время: начало и конец по местной полуночи (Берлин)", () => {
    expect(periodBounds("month", at("2026-03-15T12:00:00.000Z"), "Europe/Berlin")).toEqual({
      start: "2026-02-28T23:00:00.000Z",
      resetsAt: "2026-03-31T22:00:00.000Z",
    });
  });

  it("пояс UTC — то же, что без пояса", () => {
    for (const iso of ["2026-02-28T23:00:00.000Z", "2026-12-31T23:59:59.999Z", "2026-10-15T00:00:00.000Z"]) {
      for (const period of ["day", "month", "none"] as const) {
        expect(periodBounds(period, at(iso), "UTC")).toEqual(periodBounds(period, at(iso)));
      }
    }
  });
});
