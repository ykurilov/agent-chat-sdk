import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runSalesReviewDemo } from "../demo/sales-review-demo";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

it("демо «Разбор»: заявка агента ведёт в «Поиск затыка», вопрос о цене — из «Общего», начало запроса цело", async () => {
  const result = await runSalesReviewDemo();
  expect(result.states).toEqual(["intro", "block", "block"]);
  expect(result.transcript.at(-1)).toContain("Разбор бесплатный");
  expect(result.prefixKept).toBe(true);
  expect(result.sameInstructions).toBe(true);
});
