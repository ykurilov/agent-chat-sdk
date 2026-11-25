import { describe, expect, it } from "vitest";
import { pauseNoticeMs, pauseText } from "../../src/runtime/tail/pause-line";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { memoryFlowStore } from "../../src/store/memory";
import { mockModelId } from "../../../core/tests/unit/support/mock-model";

// Сколько прошло словами — по часам и поясу человека.

const MSK = "Europe/Moscow";
const at = (year: number, month: number, day: number, hour = 12) => Date.UTC(year, month - 1, day, hour - 3);
const MIN = 60_000;

describe("pauseText", () => {
  it("минуты, часы, дни с верными окончаниями", () => {
    expect(pauseText(0, 30 * MIN, MSK)).toBe("30 минут");
    expect(pauseText(0, 21 * MIN, MSK)).toBe("21 минуту");
    expect(pauseText(0, 3 * 60 * MIN, MSK)).toBe("3 часа");
    expect(pauseText(at(2026, 10, 1), at(2026, 10, 2), MSK)).toBe("1 день");
    expect(pauseText(at(2026, 10, 1), at(2026, 10, 12), MSK)).toBe("11 дней");
    expect(pauseText(at(2026, 10, 1), at(2026, 10, 23), MSK)).toBe("22 дня");
  });

  it("месяцы — календарные; год и остаток месяцев", () => {
    expect(pauseText(at(2026, 9, 3), at(2026, 11, 3), MSK)).toBe("2 месяца");
    expect(pauseText(at(2026, 9, 3), at(2026, 11, 2), MSK)).toBe("1 месяц");
    expect(pauseText(at(2026, 1, 31), at(2026, 2, 28), MSK)).toBe("28 дней");
    expect(pauseText(at(2026, 1, 10), at(2027, 1, 10), MSK)).toBe("1 год");
    expect(pauseText(at(2026, 1, 10), at(2028, 6, 10), MSK)).toBe("2 года 5 месяцев");
    expect(pauseText(at(2020, 1, 10), at(2025, 1, 10), MSK)).toBe("5 лет");
  });
});

describe("pauseNotice в настройках", () => {
  const build = (pauseNotice: unknown) =>
    buildAgentFlow({
      loadFlow: async () => null,
      store: memoryFlowStore(),
      judge: { fallback: { modelId: mockModelId, providerId: "mock" } },
      pauseNotice: pauseNotice as never,
    });

  it("срок переводится в мс; не срок — TypeError при создании", () => {
    expect(pauseNoticeMs({ after: { amount: 3, unit: "d" } })).toBe(3 * 86_400_000);
    expect(() => build({ after: { amount: 0, unit: "d" } })).toThrow(TypeError);
    expect(() => build({ after: { amount: 2, unit: "week" } })).toThrow(TypeError);
    expect(() => build({ after: { amount: 2, unit: "h" } })).not.toThrow();
  });
});
