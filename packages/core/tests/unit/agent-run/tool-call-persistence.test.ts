import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CALL_SAVE_WAIT_MS, gateToolCalls } from "../../../src/agent-run/tool-call-gate";

type CallOptions = Parameters<NonNullable<ToolSet[string]["execute"]>>[1];
const call = { toolCallId: "effect-1", messages: [], context: {}, abortSignal: new AbortController().signal } as unknown as CallOptions;
afterEach(() => vi.useRealTimers());

describe("инструмент выполняется только после записи намерения", () => {
  it("отказ записи не вызывает внешний эффект", async () => {
    const execute = vi.fn(async () => "отправлено");
    const tools = gateToolCalls({ effect: tool({ inputSchema: z.object({}), execute }) }, {
      closed: () => false,
      callSaved: async () => { throw new Error("storage unavailable"); },
    })!;
    await expect(tools.effect!.execute!({}, call)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("зависшая запись: срок ожидания отказывает, поздний успех не запускает инструмент", async () => {
    vi.useFakeTimers();
    let saved!: () => void;
    const pending = new Promise<void>((resolve) => { saved = resolve; });
    const execute = vi.fn(async () => "отправлено");
    const tools = gateToolCalls({ effect: tool({ inputSchema: z.object({}), execute }) }, { closed: () => false, callSaved: () => pending })!;
    const outcome = Promise.resolve(tools.effect!.execute!({}, call)).then(() => "executed", () => "refused");
    await vi.advanceTimersByTimeAsync(CALL_SAVE_WAIT_MS);
    expect(await outcome).toBe("refused");
    saved();
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
  });

  it("асинхронный генератор тоже не начинает внешнее действие после отказа записи", async () => {
    const effect = vi.fn();
    async function* execute() { effect(); yield "отправлено"; }
    const tools = gateToolCalls({ effect: tool({ inputSchema: z.object({}), execute }) }, {
      closed: () => false, callSaved: async () => { throw new Error("storage unavailable"); },
    })!;
    const output = tools.effect!.execute!({}, call) as AsyncIterable<unknown>;
    await expect((async () => { for await (const _ of output) {} })()).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
  });

  it("долгая запись успела, но шаг успел закрыться: действие не начинается", async () => {
    let saved!: () => void;
    let closed = false;
    const execute = vi.fn(async () => "отправлено");
    const tools = gateToolCalls({ effect: tool({ inputSchema: z.object({}), execute }) }, {
      closed: () => closed, callSaved: () => new Promise<void>((resolve) => { saved = resolve; }),
    })!;
    const outcome = Promise.resolve(tools.effect!.execute!({}, call)).then(() => "executed", () => "refused");
    closed = true;
    saved();
    expect(await outcome).toBe("refused");
    expect(execute).not.toHaveBeenCalled();
  });

  it("подтверждённая запись открывает ровно одно действие", async () => {
    const execute = vi.fn(async () => "отправлено");
    const tools = gateToolCalls({ effect: tool({ inputSchema: z.object({}), execute }) }, { closed: () => false, callSaved: async () => {} })!;
    expect(await tools.effect!.execute!({}, call)).toBe("отправлено");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
