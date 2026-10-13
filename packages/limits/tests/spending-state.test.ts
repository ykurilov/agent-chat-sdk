import { describe, expect, it } from "vitest";
import { spendingState } from "../src/spending-state";

describe("spendingState: норма, предупреждение, исчерпано", () => {
  it("ниже порога — норма", () => {
    expect(spendingState({ spentUsd: 3.9, limitUsd: 5, warnAt: 0.8 })).toEqual({ state: "ok", share: 0.78 });
  });

  it("ровно на пороге — предупреждение", () => {
    expect(spendingState({ spentUsd: 4, limitUsd: 5, warnAt: 0.8 }).state).toBe("warning");
  });

  it("ровно на бюджете — исчерпано", () => {
    expect(spendingState({ spentUsd: 5, limitUsd: 5, warnAt: 0.8 })).toEqual({ state: "exhausted", share: 1 });
  });

  it("перерасход — исчерпано, доля больше единицы", () => {
    expect(spendingState({ spentUsd: 5.5, limitUsd: 5, warnAt: 0.8 })).toEqual({ state: "exhausted", share: 1.1 });
  });

  it("нулевой бюджет исчерпан сразу", () => {
    expect(spendingState({ spentUsd: 0, limitUsd: 0, warnAt: 0.8 })).toEqual({ state: "exhausted", share: 1 });
  });

  it("копейки не теряются на дробях: 0,1 + 0,2 ровно на бюджете 0,3", () => {
    expect(spendingState({ spentUsd: 0.1 + 0.2, limitUsd: 0.3, warnAt: 0.8 }).state).toBe("exhausted");
  });
});
