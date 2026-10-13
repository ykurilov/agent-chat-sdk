import { describe, expect, it } from "vitest";
import { isOptimizationBlocked, pauseAfterFailure, revertRefusal } from "../../src/memory/memory-optimization";
import type { MemoryOptimizationRules, OptimizationRunTiming } from "../../src/memory/memory-optimization";

const HOUR = 3_600_000;
const rules = (retryAfterFailureMs: MemoryOptimizationRules["retryAfterFailureMs"]): MemoryOptimizationRules => ({ minIntervalMs: 24 * HOUR, retryAfterFailureMs, leaseMs: 5 * 60_000 });
const failed = (endedAtHours: number): OptimizationRunTiming => ({ status: "failed", startedAtMs: endedAtHours * HOUR, endedAtMs: endedAtHours * HOUR });

describe("пауза после неудач", () => {
  it("число — одна пауза на все неудачи", () => {
    expect([1, 2, 5].map((count) => pauseAfterFailure(rules(HOUR), count))).toEqual([HOUR, HOUR, HOUR]);
  });

  it("список — по номеру неудачи подряд, последняя держится дальше", () => {
    const ladder = rules([1 * HOUR, 6 * HOUR, 24 * HOUR]);
    expect([1, 2, 3, 4, 10].map((count) => pauseAfterFailure(ladder, count))).toEqual([HOUR, 6 * HOUR, 24 * HOUR, 24 * HOUR, 24 * HOUR]);
  });

  it("история без запусков ничему не мешает; идущий запуск мешает всегда", () => {
    expect(isOptimizationBlocked([], rules(HOUR), 0)).toBe(false);
    expect(isOptimizationBlocked([{ status: "running", startedAtMs: 0, endedAtMs: null }], rules(HOUR), 1000 * HOUR)).toBe(true);
  });

  it("счёт неудач идёт по порядку начала, а не по порядку в списке", () => {
    const ladder = rules([1 * HOUR, 6 * HOUR]);
    // Две неудачи подряд (концы в 0 ч и 1 ч): после второй пауза 6 ч.
    const runs = [failed(1), failed(0)];
    expect(isOptimizationBlocked(runs, ladder, 1 * HOUR + 6 * HOUR - 1)).toBe(true);
    expect(isOptimizationBlocked(runs, ladder, 1 * HOUR + 6 * HOUR)).toBe(false);
  });

  it("законченный запуск обнуляет счёт и ждёт общий срок", () => {
    const ladder = rules([1 * HOUR, 6 * HOUR]);
    const runs: OptimizationRunTiming[] = [failed(0), failed(1), { status: "no_changes", startedAtMs: 10 * HOUR, endedAtMs: 10 * HOUR }, failed(40)];
    // Последняя неудача — первая в новой цепочке: пауза час.
    expect(isOptimizationBlocked(runs, ladder, 40 * HOUR + HOUR - 1)).toBe(true);
    expect(isOptimizationBlocked(runs, ladder, 40 * HOUR + HOUR)).toBe(false);
  });
});

describe("отказ при возврате слияния", () => {
  it("повтор — duplicate, всё остальное — limit_reached", () => {
    expect(revertRefusal({ kind: "duplicate", message: "" })).toBe("duplicate");
    expect(revertRefusal({ kind: "limit_reached", message: "" })).toBe("limit_reached");
    expect(revertRefusal({ kind: "invalid", message: "" })).toBe("limit_reached");
  });
});
