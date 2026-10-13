import { describe, expect, it } from "vitest";
import { englishLabels, englishWorkLabels, russianLabels } from "../src/labels";
import type { SpendingInfo } from "../src/spending-status";

const cyrillic = /[А-Яа-яЁё]/;

/** Ключи словаря без значений: у английского должны быть те же, что у русского. */
const shape = (value: unknown): unknown =>
  typeof value === "function"
    ? "fn"
    : Array.isArray(value)
      ? "list"
      : typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]))
        : "text";

const spendingCases: SpendingInfo[] = [
  { scope: "user", period: "month", share: 0.8, resetsAt: new Date("2026-11-01T00:00:00Z"), timeZone: "Europe/Moscow" },
  { scope: "chat", period: "rolling", hours: 5, share: 1, resetsAt: new Date("2026-10-11T15:00:00Z"), reason: "reserve" },
  { scope: "service", period: "day", share: null, resetsAt: null, reason: "blocked" },
  { scope: "user", period: "week", share: 1, resetsAt: null, unit: "messages", remaining: 2 },
];

/** Варианты аргументов: функция словаря берёт число, строку, список, дату или сведения о лимите. */
const argumentSets: unknown[][] = [
  [3, 5],
  [1, 1],
  [125_000, true],
  [65_000, false],
  ["Sea trip", "done"],
  ["Which one?", ["Sea", "Mountains"]],
  [undefined, 10],
  [new Date("2026-10-11T12:00:00Z")],
  ...spendingCases.map((info) => [info]),
  ...spendingCases.map((info) => [2, info]),
];

/** Все тексты словаря: строки как есть, функции — с каждым набором аргументов, что не падает. */
function allTexts(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") {
    return argumentSets.flatMap((args) => {
      try {
        const result: unknown = (value as (...items: unknown[]) => unknown)(...args);
        return typeof result === "string" ? ([[path, result]] as Array<[string, string]>) : [];
      } catch {
        return [];
      }
    });
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => allTexts(item, `${path}[${index}]`));
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, item]) => allTexts(item, path ? `${path}.${key}` : key));
  return [];
}

describe("englishLabels: полный английский словарь чата", () => {
  it("те же ключи, что у русского: ничего не достаётся из русского по умолчанию", () => {
    expect(shape(englishLabels)).toEqual(shape(russianLabels));
  });

  it("ни одной русской буквы — ни в строках, ни в том, что возвращают функции", () => {
    const texts = allTexts(englishLabels);
    expect(texts.length).toBeGreaterThan(300);
    expect(texts.filter(([, text]) => cyrillic.test(text))).toEqual([]);
  });

  it("подписи версий 18 и 21 — те же, что в englishWorkLabels", () => {
    const { helpers, tasks, notices, messengerStatus, steeringPending } = englishLabels;
    expect({ helpers, tasks, notices, messengerStatus, steeringPending }).toEqual(englishWorkLabels);
  });

  it("числа и даты по-английски", () => {
    expect(englishLabels.spendingMessagesLeft(1, spendingCases[3]!)).toBe("1 message left");
    expect(englishLabels.spendingMessagesLeft(2, spendingCases[3]!)).toBe("2 messages left");
    expect(englishLabels.spendingExhausted(spendingCases[0]!)).toBe("The limit for the month is used up, renews November 1");
    expect(englishLabels.thinkingElapsed(65)).toBe("1 min 5 s");
  });
});
