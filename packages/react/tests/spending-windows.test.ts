import { describe, expect, it } from "vitest";
import { russianLabels } from "../src/labels";
import { spendingInfoOf, spendingViewOf } from "../src/spending-status";

const resetsAt = "2026-10-07T14:00:00.000Z";

describe("лимиты с окнами в браузере", () => {
  it("разбор: неделя, скользящее окно с часами, сервис, причина и все окна — без долларов", () => {
    expect(spendingInfoOf({ scope: "service", period: "week", share: 0.5, resetsAt, timeZone: "Europe/Moscow" })).toMatchObject({
      scope: "service",
      period: "week",
      timeZone: "Europe/Moscow",
    });
    const view = spendingViewOf({
      state: "exhausted",
      reason: "reserve",
      scope: "user",
      period: "rolling",
      hours: 5,
      share: 0.95,
      resetsAt,
      windowId: "5h",
      windows: [
        { id: "5h", scope: "user", period: "rolling", hours: 5, state: "warning", share: 0.95, resetsAt },
        { id: "week", scope: "user", period: "week", state: "ok", share: 0.3, resetsAt: null },
      ],
    });
    expect(view).toEqual({
      state: "exhausted",
      info: {
        scope: "user",
        period: "rolling",
        hours: 5,
        share: 0.95,
        resetsAt: new Date(resetsAt),
        reason: "reserve",
        windowId: "5h",
        windows: [
          { id: "5h", scope: "user", period: "rolling", hours: 5, state: "warning", share: 0.95, resetsAt: new Date(resetsAt) },
          { id: "week", scope: "user", period: "week", state: "ok", share: 0.3, resetsAt: null },
        ],
      },
    });
  });

  it("блокировка: без области и срока — причина blocked, обновления нет", () => {
    expect(spendingViewOf({ state: "exhausted", blocked: true, reason: "blocked" })).toEqual({
      state: "exhausted",
      info: { scope: "user", period: "none", share: null, resetsAt: null, reason: "blocked" },
    });
  });

  it("надписи: неделя, N часов со временем обновления, сервис, запас, блокировка", () => {
    const base = { scope: "user" as const, share: 0.85, resetsAt: new Date(resetsAt), timeZone: "Europe/Moscow" };
    expect(russianLabels.spendingWarning({ ...base, period: "week" })).toBe("Использовано 85% лимита на неделю");
    expect(russianLabels.spendingWarning({ ...base, period: "rolling", hours: 5 })).toBe("Использовано 85% лимита на 5 ч");
    expect(russianLabels.spendingWarning({ ...base, scope: "service", period: "day" })).toBe("Использовано 85% лимита сервиса на день");
    expect(russianLabels.spendingExhausted({ ...base, period: "rolling", hours: 5 })).toBe("Лимит на 5 ч исчерпан, обновится 7 октября в 17:00");
    expect(russianLabels.spendingExhausted({ ...base, period: "week", reason: "limit" })).toBe("Лимит на неделю исчерпан, обновится 7 октября");
    expect(russianLabels.spendingExhausted({ ...base, period: "rolling", hours: 5, reason: "reserve" })).toBe(
      "Лимита на 5 ч не хватит на новый ответ, обновится 7 октября в 17:00",
    );
    expect(russianLabels.spendingExhausted({ scope: "user", period: "none", share: null, resetsAt: null, reason: "blocked" })).toBe(
      "Новые ответы для вас приостановлены",
    );
  });
});

describe("лимит сообщений в браузере", () => {
  it("разбор: unit и остаток у отказа и статуса, числа у окна сообщений; у денежного окна полей нет", () => {
    expect(spendingInfoOf({ scope: "user", period: "day", resetsAt, reason: "limit", windowId: "day", unit: "messages" })).toEqual({
      scope: "user",
      period: "day",
      share: null,
      resetsAt: new Date(resetsAt),
      reason: "limit",
      windowId: "day",
      unit: "messages",
    });
    const view = spendingViewOf({
      state: "warning",
      scope: "user",
      period: "day",
      share: 0.8,
      resetsAt,
      windowId: "day",
      unit: "messages",
      remaining: 1,
      windows: [
        { id: "day", scope: "user", period: "day", state: "warning", share: 0.8, resetsAt, unit: "messages", limit: 5, used: 4, remaining: 1 },
        { id: "money", scope: "user", period: "day", state: "ok", share: 0.1, resetsAt, unit: "usd" },
      ],
    });
    expect(view?.info).toMatchObject({ unit: "messages", remaining: 1 });
    expect(view?.info.windows).toEqual([
      { id: "day", scope: "user", period: "day", state: "warning", share: 0.8, resetsAt: new Date(resetsAt), unit: "messages", limit: 5, used: 4, remaining: 1 },
      { id: "money", scope: "user", period: "day", state: "ok", share: 0.1, resetsAt: new Date(resetsAt) },
    ]);
  });

  it("надписи: «Осталось N сообщений» с формами числа, «Лимит сообщений исчерпан, обновится …»", () => {
    const base = { scope: "user" as const, period: "day" as const, share: 0.8, resetsAt: new Date(resetsAt), timeZone: "Europe/Moscow", unit: "messages" as const };
    const left = (remaining: number) => russianLabels.spendingMessagesLeft!(remaining, { ...base, remaining });
    expect([1, 2, 5, 11, 21, 22, 0].map(left)).toEqual([
      "Осталось 1 сообщение",
      "Осталось 2 сообщения",
      "Осталось 5 сообщений",
      "Осталось 11 сообщений",
      "Осталось 21 сообщение",
      "Осталось 22 сообщения",
      "Осталось 0 сообщений",
    ]);
    expect(russianLabels.spendingMessagesExhausted!({ ...base, share: null })).toBe("Лимит сообщений исчерпан, обновится 7 октября");
    expect(russianLabels.spendingMessagesExhausted!({ ...base, period: "rolling", hours: 5 })).toBe("Лимит сообщений исчерпан, обновится 7 октября в 17:00");
    expect(russianLabels.spendingMessagesExhausted!({ ...base, period: "none", resetsAt: null })).toBe("Лимит сообщений исчерпан");
  });
});
