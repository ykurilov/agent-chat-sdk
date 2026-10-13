import { describe, expect, it } from "vitest";
import { createWindowBudget } from "../src/server/window-budget";

function budgetAt(max: number, windowMs: number) {
  let clock = 1_000_000;
  const budget = createWindowBudget({ max, windowMs, now: () => clock });
  return { budget, advance: (ms: number) => void (clock += ms) };
}

describe("окно расхода: сколько можно взять за окно", () => {
  it("берёт, пока сумма за окно не выше потолка; лишнее отказывает и не записывается", () => {
    const { budget } = budgetAt(100, 60_000);
    expect(budget.take("anna", 60)).toBe(true);
    expect(budget.take("anna", 50)).toBe(false);
    expect(budget.take("anna", 40)).toBe(true);
    expect(budget.take("anna", 1)).toBe(false);
  });

  it("окно скользит: взятое раньше окна больше не считается", () => {
    const { budget, advance } = budgetAt(100, 60_000);
    budget.take("anna", 100);
    advance(59_999);
    expect(budget.take("anna", 1)).toBe(false);
    advance(1);
    expect(budget.take("anna", 100)).toBe(true);
  });

  it("у каждого ключа свой счёт", () => {
    const { budget } = budgetAt(100, 60_000);
    expect(budget.take("anna", 100)).toBe(true);
    expect(budget.take("boris", 100)).toBe(true);
    expect(budget.take("anna", 1)).toBe(false);
  });

  it("кусок больше потолка не проходит никогда", () => {
    const { budget } = budgetAt(100, 60_000);
    expect(budget.take("anna", 101)).toBe(false);
    expect(budget.take("anna", 100)).toBe(true);
  });

  it("много мелких кусков в одну миллисекунду считаются верно", () => {
    const { budget } = budgetAt(1000, 1000);
    for (let index = 0; index < 1000; index += 1) expect(budget.take("anna", 1)).toBe(true);
    expect(budget.take("anna", 1)).toBe(false);
  });
});
