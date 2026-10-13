import { jsonSchema, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineWidget } from "../../../src/widgets/define-widget";
import { WIDGET_ANSWER_MAX_BYTES, createAgentWidgets, withWidgetTools } from "../../../src/widgets/widget-tools";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";

const pickSlot = defineWidget({
  name: "pick_slot",
  description: "Выбрать время",
  inputSchema: z.object({ slots: z.array(z.string()).min(2) }),
  answerSchema: z.object({ slot: z.string() }),
});

const model = {} as AgentToolsModel;

describe("createAgentWidgets", () => {
  it("без настройки — ни инструментов, ни ждущих", () => {
    const widgets = createAgentWidgets(undefined);
    expect(widgets.tools).toEqual({});
    expect([...widgets.waiting]).toEqual([]);
  });

  it("basic: true — пять базовых по имени; ждут все, кроме подсказок", () => {
    const widgets = createAgentWidgets({ basic: true });
    expect(Object.keys(widgets.tools)).toEqual(["ask_choice", "ask_form", "ask_multi_choice", "ask_rating", "suggest_replies"]);
    expect([...widgets.waiting].sort()).toEqual(["ask_choice", "ask_form", "ask_multi_choice", "ask_rating"]);
    expect(widgets.tools.ask_choice!.execute).toBeUndefined();
    expect(widgets.tools.suggest_replies!.execute).toBeTypeOf("function");
  });

  it("список базовых и свои — только они, по имени; свой — без execute, со своим описанием и схемой", () => {
    const widgets = createAgentWidgets({ basic: ["suggest_replies", "ask_choice"], custom: [pickSlot] });
    expect(Object.keys(widgets.tools)).toEqual(["ask_choice", "pick_slot", "suggest_replies"]);
    expect([...widgets.waiting].sort()).toEqual(["ask_choice", "pick_slot"]);
    expect(widgets.tools.pick_slot).toMatchObject({ description: "Выбрать время", inputSchema: pickSlot.inputSchema });
    expect(widgets.tools.pick_slot!.execute).toBeUndefined();
  });

  it("негодная настройка — исключение: чужой базовый, негодное имя своего, повтор своего", () => {
    expect(() => createAgentWidgets({ basic: ["ask_everything" as never] })).toThrow(/ask_everything/);
    expect(() => createAgentWidgets({ custom: [{ ...pickSlot, name: "ask_slot" }] })).toThrow(/ask_slot/);
    expect(() => createAgentWidgets({ custom: [pickSlot, pickSlot] })).toThrow(/pick_slot/);
  });

  describe("checkAnswer", () => {
    const widgets = createAgentWidgets({ basic: true, custom: [pickSlot] });

    it("базовый — по входу вызова", async () => {
      const input = { question: "?", options: ["а", "б"] };
      expect(await widgets.checkAnswer("ask_choice", input, { выбрано: "б" })).toEqual({ ok: true, output: { выбрано: "б" } });
      expect((await widgets.checkAnswer("ask_choice", input, { выбрано: "в" })).ok).toBe(false);
    });

    it("свой — по answerSchema", async () => {
      expect(await widgets.checkAnswer("pick_slot", { slots: ["1", "2"] }, { slot: "1" })).toEqual({ ok: true, output: { slot: "1" } });
      expect((await widgets.checkAnswer("pick_slot", { slots: ["1", "2"] }, { slot: 1 })).ok).toBe(false);
    });

    it("JSON ответа больше 16 КБ — отказ, даже если схема его пропускает", async () => {
      const big = createAgentWidgets({ custom: [{ ...pickSlot, name: "free", answerSchema: z.object({ text: z.string() }) }] });
      const fits = "я".repeat((WIDGET_ANSWER_MAX_BYTES - 20) / 2);
      expect((await big.checkAnswer("free", {}, { text: fits })).ok).toBe(true);
      expect((await big.checkAnswer("free", {}, { text: `${fits}яяяяяя` })).ok).toBe(false);
    });

    it("свой на JSON Schema с проверкой — проверка работает", async () => {
      const validate = vi.fn((value: unknown) =>
        typeof value === "number" ? { success: true as const, value } : { success: false as const, error: new Error("не число") },
      );
      const numeric = createAgentWidgets({
        custom: [defineWidget({ name: "count", description: "Сколько", inputSchema: jsonSchema({ type: "object" }), answerSchema: jsonSchema<number>({ type: "number" }, { validate }) })],
      });
      expect((await numeric.checkAnswer("count", {}, 3)).ok).toBe(true);
      expect((await numeric.checkAnswer("count", {}, "3")).ok).toBe(false);
    });

    it("на подсказки и неизвестный виджет не отвечают", async () => {
      expect((await widgets.checkAnswer("suggest_replies", { replies: ["Да"] }, "Да")).ok).toBe(false);
      expect((await widgets.checkAnswer("remove", {}, {})).ok).toBe(false);
    });
  });
});

describe("withWidgetTools", () => {
  const widgets = createAgentWidgets({ basic: ["ask_choice"] });
  const remove = tool({ description: "Удалить", inputSchema: z.object({ path: z.string() }), execute: async () => "ok" });

  it("без виджетов — те же инструменты приложения, тот же объект", () => {
    const tools = { remove };
    expect(withWidgetTools(tools, createAgentWidgets(undefined), console.error)).toBe(tools);
    expect(withWidgetTools(undefined, createAgentWidgets(undefined), console.error)).toBeUndefined();
  });

  it("набор — виджеты рядом с инструментами приложения", () => {
    const merged = withWidgetTools({ remove }, widgets, console.error);
    expect(typeof merged).toBe("object");
    expect(Object.keys(merged as object).sort()).toEqual(["ask_choice", "remove"]);
    expect(Object.keys(withWidgetTools(undefined, widgets, console.error) as object)).toEqual(["ask_choice"]);
  });

  it("повтор имени в наборе — исключение сразу", () => {
    expect(() => withWidgetTools({ ask_choice: remove }, widgets, console.error)).toThrow(/ask_choice/);
  });

  it("функция — виджеты рядом с её набором; повтор имени — ошибка хода и строка в журнал", () => {
    const logError = vi.fn();
    const merged = withWidgetTools(() => ({ remove }), widgets, logError);
    expect(typeof merged).toBe("function");
    expect(Object.keys((merged as (model: AgentToolsModel) => object)(model)).sort()).toEqual(["ask_choice", "remove"]);
    const clashing = withWidgetTools(() => ({ ask_choice: remove }), widgets, logError) as (model: AgentToolsModel) => object;
    expect(() => clashing(model)).toThrow(/ask_choice/);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("ask_choice"));
  });
});
