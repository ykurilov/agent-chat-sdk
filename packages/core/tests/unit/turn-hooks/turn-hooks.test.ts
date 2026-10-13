import { describe, expect, it } from "vitest";
import {
  APP_EVENT_DATA_MAX_BYTES,
  isTurnRefusalCode,
  normalizeTurnRefusal,
  TURN_REFUSAL_MESSAGE_MAX_LENGTH,
  TurnRefusedError,
  validateAppEvent,
} from "../../../src/index";

describe("отказ в ходе", () => {
  it("код — латиница в нижнем регистре, цифры и . _ -, от 1 до 64 знаков", () => {
    for (const code of ["lesson_closed", "a", "plan.free-tier_2", "x".repeat(64)]) expect(isTurnRefusalCode(code)).toBe(true);
    for (const code of ["", "x".repeat(65), "Lesson", "урок", "a b", "a/b", 42, null, undefined]) expect(isTurnRefusalCode(code)).toBe(false);
  });

  it("текст длиннее 300 знаков обрезается, эмодзи не рвётся пополам", () => {
    expect(TURN_REFUSAL_MESSAGE_MAX_LENGTH).toBe(300);
    const long = normalizeTurnRefusal({ code: "lesson_closed", message: "а".repeat(299) + "🙂🙂" });
    expect(Array.from(long.message)).toHaveLength(300);
    expect(long.message.endsWith("🙂")).toBe(true);
    expect(normalizeTurnRefusal({ code: "lesson_closed", message: "Урок закрыт" })).toEqual({ code: "lesson_closed", message: "Урок закрыт" });
  });

  it("неверный код или текст не строкой — TypeError", () => {
    expect(() => normalizeTurnRefusal({ code: "Bad Code", message: "x" })).toThrow(TypeError);
    expect(() => normalizeTurnRefusal({ code: "ok", message: 5 as unknown as string })).toThrow(TypeError);
  });

  it("TurnRefusedError несёт код и текст отказа", () => {
    const error = new TurnRefusedError({ code: "lesson_closed", message: "Урок закрыт" });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TurnRefusedError");
    expect(error.code).toBe("lesson_closed");
    expect(error.message).toBe("Урок закрыт");
    expect(error.refusal).toEqual({ code: "lesson_closed", message: "Урок закрыт" });
    expect(new TurnRefusedError({ code: "x", message: "я".repeat(400) }).message).toHaveLength(300);
  });
});

describe("событие приложения", () => {
  it("тип 1–100 знаков, данные — JSON до 16 КБ; без данных можно", () => {
    expect(validateAppEvent({ type: "lesson_passed", data: { lesson: 7, score: 0.9 } })).toEqual({ type: "lesson_passed", data: { lesson: 7, score: 0.9 } });
    expect(validateAppEvent({ type: "x".repeat(100) })).toEqual({ type: "x".repeat(100) });
    expect(APP_EVENT_DATA_MAX_BYTES).toBe(16 * 1024);
  });

  it("неверная форма — TypeError", () => {
    const bad: unknown[] = [
      null,
      "lesson_passed",
      { type: "" },
      { type: "x".repeat(101) },
      { type: 5 },
      { type: "big", data: "я".repeat(APP_EVENT_DATA_MAX_BYTES) },
      { type: "fn", data: () => 1 },
      { type: "bigint", data: { n: 10n } },
    ];
    for (const event of bad) expect(() => validateAppEvent(event)).toThrow(TypeError);
  });

  it("данные ровно в предел проходят (считаются байты UTF-8 записи JSON)", () => {
    const text = "x".repeat(APP_EVENT_DATA_MAX_BYTES - 2);
    expect(() => validateAppEvent({ type: "edge", data: text })).not.toThrow();
    expect(() => validateAppEvent({ type: "edge", data: `${text}x` })).toThrow(TypeError);
  });

  it("отдаёт копию: правка исходных данных событие не меняет", () => {
    const data = { list: [1] };
    const event = validateAppEvent({ type: "copy", data });
    data.list.push(2);
    expect(event.data).toEqual({ list: [1] });
  });
});
