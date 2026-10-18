import { describe, expect, it } from "vitest";
import { parseDuration } from "../src/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("099 parseDuration: «своё время» тестового чата", () => {
  it("по-русски: полные слова, сокращения, пробелы и их отсутствие", () => {
    expect(parseDuration("15 мин")).toBe(15 * MINUTE);
    expect(parseDuration("15мин")).toBe(15 * MINUTE);
    expect(parseDuration("1 ч 30 мин")).toBe(HOUR + 30 * MINUTE);
    expect(parseDuration("1ч30м")).toBe(HOUR + 30 * MINUTE);
    expect(parseDuration("2 дня")).toBe(2 * DAY);
    expect(parseDuration("1 день 2 часа")).toBe(DAY + 2 * HOUR);
    expect(parseDuration("5 дней, 3 часа и 10 минут")).toBe(5 * DAY + 3 * HOUR + 10 * MINUTE);
    expect(parseDuration("  45 Мин.  ")).toBe(45 * MINUTE);
    expect(parseDuration("1,5 ч")).toBe(90 * MINUTE);
  });

  it("по-английски", () => {
    expect(parseDuration("15 min")).toBe(15 * MINUTE);
    expect(parseDuration("1h 30m")).toBe(HOUR + 30 * MINUTE);
    expect(parseDuration("2 days")).toBe(2 * DAY);
    expect(parseDuration("1 day and 3 hours")).toBe(DAY + 3 * HOUR);
    expect(parseDuration("90 minutes")).toBe(90 * MINUTE);
    expect(parseDuration("1.5h")).toBe(90 * MINUTE);
  });

  it("непонятное, пустое, ноль и число без единицы — undefined", () => {
    for (const text of ["", "   ", "скоро", "15", "15 лет", "0 мин", "ч 15", "1 ч ерунда", "-5 мин", "1h30"]) {
      expect(parseDuration(text), text).toBeUndefined();
    }
  });
});
