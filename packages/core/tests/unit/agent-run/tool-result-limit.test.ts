import { tool } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cutToolResult, resolveToolResultLimit } from "../../../src/agent-run/tool-result-limit";
import { trackToolErrors } from "../../../src/agent-run/tool-errors";
import { withoutLoneSurrogates } from "../../../src/text/safe-truncate";

const noToolOptions = { toolCallId: "call-1", messages: [] };

describe("resolveToolResultLimit", () => {
  it("по умолчанию предел 50 000 для любого инструмента", () => {
    expect(resolveToolResultLimit(undefined).forTool("list_tasks")).toBe(50_000);
    expect(resolveToolResultLimit({}).forTool("list_tasks")).toBe(50_000);
  });

  it("число действует для всех инструментов", () => {
    const limit = resolveToolResultLimit(2000);
    expect(limit.forTool("a")).toBe(2000);
    expect(limit.forTool("b")).toBe(2000);
  });

  it("`byTool` задаёт свой предел инструменту, `default` — остальным", () => {
    const limit = resolveToolResultLimit({ default: 3000, byTool: { read_page: 9000 } });
    expect(limit.forTool("read_page")).toBe(9000);
    expect(limit.forTool("other")).toBe(3000);
  });

  it("`byTool` без `default` оставляет остальным 50 000", () => {
    expect(resolveToolResultLimit({ byTool: { read_page: 9000 } }).forTool("other")).toBe(50_000);
  });

  it.each([
    ["дробное число", 1500.5],
    ["меньше 1000", 999],
    ["ноль", 0],
    ["не число", Number.NaN],
    ["бесконечность", Number.POSITIVE_INFINITY],
  ])("%s → TypeError с понятным текстом", (_name, value) => {
    expect(() => resolveToolResultLimit(value)).toThrow(TypeError);
    expect(() => resolveToolResultLimit(value)).toThrow(/toolResultMaxLength.*1000/);
  });

  it("плохой `default` или предел в `byTool` — тоже TypeError, текст называет инструмент", () => {
    expect(() => resolveToolResultLimit({ default: 10 })).toThrow(TypeError);
    expect(() => resolveToolResultLimit({ byTool: { read_page: 10 } })).toThrow(/read_page/);
  });
});

describe("cutToolResult", () => {
  it("короткая строка остаётся как есть", () => {
    expect(cutToolResult("привет", 1000)).toEqual({ cut: false });
  });

  it("строка ровно в предел не режется", () => {
    expect(cutToolResult("а".repeat(1000), 1000)).toEqual({ cut: false });
  });

  it("не строка меряется по JSON; в пределе — не трогается", () => {
    expect(cutToolResult({ tasks: [1, 2, 3] }, 1000)).toEqual({ cut: false });
  });

  it("длинная строка → начало и пометка «показано N из M знаков»", () => {
    const result = cutToolResult("а".repeat(5000), 1000);
    if (!result.cut) throw new Error("ожидалась обрезка");
    expect(result.length).toBe(5000);
    expect(result.text).toMatch(/^а+\n\n\[Результат обрезан: показано \d+ из 5000 знаков\]$/);
    const shown = Number(/показано (\d+) из/.exec(result.text)?.[1]);
    expect(result.text.startsWith("а".repeat(shown) + "\n\n")).toBe(true);
    expect(result.text.indexOf("\n\n[")).toBe(shown);
  });

  it("пометка входит в предел: итог не длиннее предела и почти до него", () => {
    for (const max of [1000, 1001, 5000, 12_345]) {
      const result = cutToolResult("б".repeat(100_000), max);
      if (!result.cut) throw new Error("ожидалась обрезка");
      expect(result.text.length).toBeLessThanOrEqual(max);
      expect(result.text.length).toBeGreaterThan(max - 5);
    }
  });

  it("не строка длиннее предела режется по тексту JSON", () => {
    const output = { rows: Array.from({ length: 2000 }, (_, index) => ({ index })) };
    const full = JSON.stringify(output);
    const result = cutToolResult(output, 1000);
    if (!result.cut) throw new Error("ожидалась обрезка");
    expect(result.length).toBe(full.length);
    expect(result.text.startsWith('{"rows":[{"index":0}')).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1000);
  });

  it("эмодзи на границе не рвётся ни при каком соседнем пределе", () => {
    for (const max of [1000, 1001, 1002, 1003]) {
      const result = cutToolResult("😀".repeat(5000), max);
      if (!result.cut) throw new Error("ожидалась обрезка");
      expect(withoutLoneSurrogates(result.text)).toBe(result.text);
      expect(result.text.length).toBeLessThanOrEqual(max);
    }
  });

  it("undefined и значения без JSON не режутся и не падают", () => {
    expect(cutToolResult(undefined, 1000)).toEqual({ cut: false });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(cutToolResult(circular, 1000)).toEqual({ cut: false });
  });
});

describe("trackToolErrors: предел результата", () => {
  const big = "я".repeat(5000);
  const limit = resolveToolResultLimit(2000);

  function toolSetOf(execute: (input: unknown) => unknown, extra: object = {}): ToolSet {
    return {
      list_tasks: tool({ description: "Список.", inputSchema: z.object({}), execute: execute as () => unknown, ...extra }),
    } as ToolSet;
  }

  async function callOf(tools: ToolSet, name = "list_tasks") {
    return (tools[name]!.execute as (input: unknown, options: unknown) => unknown)({}, noToolOptions);
  }

  it("длинный результат (обещание) режется, onCut получает инструмент и полную длину", async () => {
    const onCut = vi.fn();
    const { tools } = trackToolErrors(toolSetOf(async () => big), { limit, onCut });
    const result = (await callOf(tools)) as string;
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result).toContain("[Результат обрезан: показано");
    expect(result).toContain("из 5000 знаков]");
    expect(onCut).toHaveBeenCalledExactlyOnceWith("list_tasks", 5000);
  });

  it("синхронный результат режется так же", async () => {
    const { tools } = trackToolErrors(toolSetOf(() => big), { limit });
    expect(((await callOf(tools)) as string).length).toBeLessThanOrEqual(2000);
  });

  it("короткий результат не меняется, onCut молчит; объект остаётся объектом", async () => {
    const onCut = vi.fn();
    const object = { rows: [1, 2, 3] };
    const { tools } = trackToolErrors(toolSetOf(async () => object), { limit, onCut });
    expect(await callOf(tools)).toBe(object);
    expect(onCut).not.toHaveBeenCalled();
  });

  it("без настройки предел 50 000", async () => {
    const { tools } = trackToolErrors(toolSetOf(async () => "x".repeat(200_000)));
    const result = (await callOf(tools)) as string;
    expect(result.length).toBeLessThanOrEqual(50_000);
    expect(result).toContain("из 200000 знаков]");
  });

  it("предел `byTool` берётся по имени инструмента", async () => {
    const tools = {
      read_page: tool({ description: "a", inputSchema: z.object({}), execute: async () => big }),
      other: tool({ description: "b", inputSchema: z.object({}), execute: async () => big }),
    } as ToolSet;
    const tracked = trackToolErrors(tools, { limit: resolveToolResultLimit({ byTool: { read_page: 1000 } }) }).tools;
    expect(((await callOf(tracked, "read_page")) as string).length).toBeLessThanOrEqual(1000);
    expect(await callOf(tracked, "other")).toBe(big);
  });

  it("инструмент с `toModelOutput` не режется", async () => {
    const onCut = vi.fn();
    const { tools } = trackToolErrors(
      toolSetOf(async () => big, { toModelOutput: () => ({ type: "text", value: "коротко" }) }),
      { limit, onCut },
    );
    expect(await callOf(tools)).toBe(big);
    expect(onCut).not.toHaveBeenCalled();
  });

  it("асинхронный итератор: пределом меряется последнее значение", async () => {
    const onCut = vi.fn();
    async function* partial() {
      yield "начало";
      yield big;
    }
    const { tools } = trackToolErrors(toolSetOf(() => partial()), { limit, onCut });
    const seen: string[] = [];
    for await (const value of (await callOf(tools)) as AsyncIterable<string>) seen.push(value);
    expect(seen[0]).toBe("начало");
    expect(seen.at(-1)!.length).toBeLessThanOrEqual(2000);
    expect(seen.at(-1)).toContain("[Результат обрезан");
    expect(onCut).toHaveBeenCalledExactlyOnceWith("list_tasks", 5000);
  });

  it("ошибка инструмента по-прежнему запоминается и описывается своим текстом", async () => {
    const tracker = trackToolErrors(
      toolSetOf(async () => {
        throw new Error("сервис недоступен");
      }),
      { limit },
    );
    const error = await callOf(tracker.tools).catch((caught: unknown) => caught);
    expect(tracker.describe(error)).toBe("сервис недоступен");
  });
});
