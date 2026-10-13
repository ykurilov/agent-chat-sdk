import { describe, expect, it } from "vitest";
import { closeHangingToolCalls } from "../../../src/conversation/hanging-tool-calls";
import { HANGING_TOOL_CALL_REASON } from "../../../src/tool-approval/approval-parts";
import type { AgentChatMessage } from "../../../src/conversation/types";

type Part = AgentChatMessage["parts"][number];
const part = (value: Record<string, unknown>): Part => value as never;

describe("HANGING_TOOL_CALL_REASON", () => {
  it("дословный текст для модели", () => {
    expect(HANGING_TOOL_CALL_REASON).toBe(
      "Вызов инструмента оборвался до результата: действие могло выполниться частично или целиком. Не повторяй его, не проверив, что уже сделано",
    );
  });
});

describe("closeHangingToolCalls", () => {
  it("input-available закрывается ошибкой с постоянным текстом", () => {
    const parts = [part({ type: "tool-list_tasks", toolCallId: "c1", state: "input-available", input: { a: 1 } })];
    expect(closeHangingToolCalls(parts)).toEqual([
      { type: "tool-list_tasks", toolCallId: "c1", state: "output-error", input: { a: 1 }, errorText: HANGING_TOOL_CALL_REASON },
    ]);
  });

  it("промежуточный результат (preliminary) закрывается ошибкой, а сам вывод уходит в её текст (FR-053)", () => {
    const parts = [part({ type: "tool-slow", toolCallId: "c1", state: "output-available", input: {}, output: "отправлено 3 письма из 5", preliminary: true })];
    const [closed] = closeHangingToolCalls(parts) as Array<Record<string, unknown>>;
    expect(closed).toMatchObject({
      state: "output-error",
      errorText: `${HANGING_TOOL_CALL_REASON}\nПоследний промежуточный вывод: отправлено 3 письма из 5`,
    });
    expect(closed).not.toHaveProperty("output");
    expect(closed).not.toHaveProperty("preliminary");
  });

  it("промежуточный вывод-объект — JSON; длинный обрезан до 2000 знаков с пометкой, одинаково при каждой сборке", () => {
    const object = [part({ type: "tool-slow", toolCallId: "c1", state: "output-available", input: {}, output: { sent: 3 }, preliminary: true })];
    expect((closeHangingToolCalls(object)[0] as { errorText: string }).errorText).toBe(
      `${HANGING_TOOL_CALL_REASON}\nПоследний промежуточный вывод: {"sent":3}`,
    );
    const long = [part({ type: "tool-slow", toolCallId: "c1", state: "output-available", input: {}, output: "ж".repeat(5000), preliminary: true })];
    const text = (closeHangingToolCalls(long)[0] as { errorText: string }).errorText;
    expect(text).toBe(`${HANGING_TOOL_CALL_REASON}\nПоследний промежуточный вывод: ${"ж".repeat(2000)}… [обрезано: показано 2000 из 5000 знаков]`);
    expect((closeHangingToolCalls(long)[0] as { errorText: string }).errorText).toBe(text);
  });

  it("динамический вызов закрывается так же", () => {
    const parts = [part({ type: "dynamic-tool", toolName: "mcp", toolCallId: "c1", state: "input-available", input: {} })];
    expect(closeHangingToolCalls(parts)[0]).toMatchObject({ type: "dynamic-tool", toolName: "mcp", state: "output-error", errorText: HANGING_TOOL_CALL_REASON });
  });

  it("input-streaming, подтверждения и законченные вызовы не меняются, массив тот же по ссылке", () => {
    const parts = [
      part({ type: "text", text: "т" }),
      part({ type: "tool-a", toolCallId: "1", state: "input-streaming", input: {} }),
      part({ type: "tool-a", toolCallId: "2", state: "approval-requested", input: {}, approval: { id: "x" } }),
      part({ type: "tool-a", toolCallId: "3", state: "approval-responded", input: {}, approval: { id: "y", approved: true } }),
      part({ type: "tool-a", toolCallId: "4", state: "output-available", input: {}, output: 1 }),
      part({ type: "tool-a", toolCallId: "5", state: "output-error", input: {}, errorText: "e" }),
      part({ type: "tool-a", toolCallId: "6", state: "output-denied", input: {}, approval: { id: "z", approved: false } }),
    ];
    expect(closeHangingToolCalls(parts)).toBe(parts);
  });

  it("часть исходного массива не меняется, закрытые и нетронутые части на своих местах", () => {
    const hanging = part({ type: "tool-a", toolCallId: "1", state: "input-available", input: {} });
    const text = part({ type: "text", text: "т" });
    const parts = [text, hanging];
    const result = closeHangingToolCalls(parts);
    expect(result).not.toBe(parts);
    expect(result[0]).toBe(text);
    expect(hanging).toMatchObject({ state: "input-available" });
  });

  it("повторный вызов на результате ничего не меняет (по ссылке)", () => {
    const once = closeHangingToolCalls([part({ type: "tool-a", toolCallId: "1", state: "input-available", input: {} })]);
    expect(closeHangingToolCalls(once)).toBe(once);
  });
});
