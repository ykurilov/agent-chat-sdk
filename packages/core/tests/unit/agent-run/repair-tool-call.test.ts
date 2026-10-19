import { streamText, tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRepairToolCall, describeToolInputRepair } from "../../../src/agent-run/repair-tool-call";
import type { RepairToolInput, ToolInputRepair } from "../../../src/agent-run/repair-tool-call";
import {
  extraCloserAtEnd,
  extraCloserInside,
  fieldsExtraBraceAtEndChangesText,
  flowMissingArrayCloserChangesText,
  instructionExtraBraceBeforeArrayCloserChangesText,
} from "../support/broken-tool-inputs";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";

/** Модель: на первом шаге вызывает инструмент с заданным сырым `input`, на втором отвечает текстом. */
function callingModel(toolName: string, rawInput: string): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      step++;
      return {
        stream: streamOf(
          step === 1
            ? [streamStart, { type: "tool-call", toolCallId: "call-1", toolName, input: rawInput }, finishPart("tool-calls")]
            : reasoningAndTextParts(["готово"], "думаю"),
        ),
      };
    },
  });
}

async function runCall(
  tools: ToolSet,
  rawInput: string,
  toolName = "update_task",
  onRepaired?: (repair: ToolInputRepair) => void,
  repairToolInput?: RepairToolInput,
) {
  const model = callingModel(toolName, rawInput);
  const result = streamText({
    model,
    tools,
    prompt: "сделай",
    stopWhen: ({ steps }) => steps.length >= 2,
    repairToolCall: createRepairToolCall({ ...(onRepaired && { onRepaired }), ...(repairToolInput && { repairToolInput }) }),
  });
  const parts: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const part of result.fullStream) parts.push(part as { type: string });
  return { parts, model };
}

/** Вызов инструмента, который модель увидит в истории на следующем шаге. */
function historyToolCall(model: MockLanguageModelV4) {
  const prompt = model.doStreamCalls[1]!.prompt;
  return prompt.flatMap((message) => (message.role === "assistant" ? message.content : [])).find((part) => part.type === "tool-call");
}

const updateTask = (execute: (input: { taskId: number; done: boolean }) => unknown) =>
  ({
    update_task: tool({
      description: "Обновить задачу.",
      inputSchema: z.object({ taskId: z.number(), done: z.boolean() }),
      execute: async (input) => execute(input),
    }),
  }) as ToolSet;

describe("createRepairToolCall", () => {
  it('{"taskId":"2","done":"true"} → инструмент выполнен с 2 и true (20 прогонов)', async () => {
    for (let run = 0; run < 20; run++) {
      const execute = vi.fn((_input: unknown) => "ok");
      await runCall(updateTask(execute), '{"taskId":"2","done":"true"}');
      expect(execute).toHaveBeenCalledExactlyOnceWith({ taskId: 2, done: true });
    }
  });

  it("сырой перевод строки в строке чинится, строка-число приводится", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const tools = {
      add_note: tool({
        description: "Заметка.",
        inputSchema: z.object({ text: z.string(), priority: z.number() }),
        execute: async (input) => execute(input),
      }),
    } as ToolSet;
    await runCall(tools, '{"text":"первая\nвторая","priority":"3"}', "add_note");
    expect(execute).toHaveBeenCalledExactlyOnceWith({ text: "первая\nвторая", priority: 3 });
  });

  it("приводит рекурсивно: вложенные объекты и элементы массивов", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const tools = {
      plan: tool({
        description: "План.",
        inputSchema: z.object({
          owner: z.object({ id: z.number(), active: z.boolean() }),
          ids: z.array(z.number()),
          flags: z.array(z.object({ on: z.boolean() })),
        }),
        execute: async (input) => execute(input),
      }),
    } as ToolSet;
    await runCall(tools, '{"owner":{"id":"7","active":"false"},"ids":["1","2"],"flags":[{"on":"true"}]}', "plan");
    expect(execute).toHaveBeenCalledExactlyOnceWith({ owner: { id: 7, active: false }, ids: [1, 2], flags: [{ on: true }] });
  });

  it('"abc" в числе → ошибка проверки, как раньше; инструмент не вызван', async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const { parts } = await runCall(updateTask(execute), '{"taskId":"abc","done":true}');
    expect(execute).not.toHaveBeenCalled();
    expect(parts.some((part) => part.type === "tool-error" || (part.type === "tool-call" && part.invalid === true))).toBe(true);
  });

  it('"2.5" в integer → ошибка, инструмент не вызван', async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const tools = {
      update_task: tool({
        description: "Обновить.",
        inputSchema: z.object({ taskId: z.number().int() }),
        execute: async (input) => execute(input),
      }),
    } as ToolSet;
    await runCall(tools, '{"taskId":"2.5"}');
    expect(execute).not.toHaveBeenCalled();
  });

  it('"2" в integer → 2', async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const tools = {
      update_task: tool({
        description: "Обновить.",
        inputSchema: z.object({ taskId: z.number().int() }),
        execute: async (input) => execute(input),
      }),
    } as ToolSet;
    await runCall(tools, '{"taskId":"2"}');
    expect(execute).toHaveBeenCalledExactlyOnceWith({ taskId: 2 });
  });

  it("строка в поле-строке остаётся строкой, даже если похожа на число", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const tools = {
      find: tool({
        description: "Найти.",
        inputSchema: z.object({ query: z.string(), limit: z.number() }),
        execute: async (input) => execute(input),
      }),
    } as ToolSet;
    await runCall(tools, '{"query":"42","limit":"5"}', "find");
    expect(execute).toHaveBeenCalledExactlyOnceWith({ query: "42", limit: 5 });
  });

  it("несуществующий инструмент → null (не чиним)", async () => {
    const repair = createRepairToolCall();
    const { NoSuchToolError } = await import("ai");
    const result = await repair({
      toolCall: { type: "tool-call", toolCallId: "c", toolName: "ghost", input: "{}" },
      tools: {},
      error: new NoSuchToolError({ toolName: "ghost" }),
      inputSchema: async () => ({}),
      instructions: undefined,
      system: undefined,
      messages: [],
    });
    expect(result).toBeNull();
  });

  it("битый JSON, который не чинится, → null", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const { parts } = await runCall(updateTask(execute), '{"taskId":');
    expect(execute).not.toHaveBeenCalled();
    expect(parts.length).toBeGreaterThan(0);
  });
});

const rememberTool = (execute: (input: unknown) => unknown) =>
  ({
    remember: tool({
      description: "Запомнить.",
      inputSchema: z.object({
        fields: z.array(z.object({ fieldId: z.string(), value: z.string() })).optional(),
        facts: z.array(z.string()).optional(),
      }),
      execute: async (input) => execute(input),
    }),
  }) as ToolSet;

const editTool = (execute: (input: unknown) => unknown) =>
  ({
    edit_lead_magnet: tool({
      description: "Правка.",
      inputSchema: z.object({ changes: z.array(z.object({ op: z.literal("set"), field: z.string(), value: z.string() }).strict()) }),
      execute: async (input) => execute(input),
    }),
  }) as ToolSet;

describe("createRepairToolCall: лишние закрывающие скобки (DeepSeek)", () => {
  it("лишняя `}` в конце → инструмент выполнен один раз, в истории — починенный вызов, одна запись в журнал", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const repairs: ToolInputRepair[] = [];
    const { parts, model } = await runCall(rememberTool(execute), extraCloserAtEnd, "remember", (repair) => repairs.push(repair));
    const expected = JSON.parse(extraCloserAtEnd.slice(0, -1));
    expect(execute).toHaveBeenCalledExactlyOnceWith(expected);
    expect(parts.some((part) => part.type === "tool-call" && part.invalid === true)).toBe(false);
    expect(historyToolCall(model)).toMatchObject({ toolName: "remember", input: expected });
    expect(repairs).toEqual([
      { toolName: "remember", inputLength: extraCloserAtEnd.length, strayClosers: { inside: 0, end: 1 }, missingClosers: 0, nestedJson: false, byApp: false, strings: false, types: false },
    ]);
  });

  it("лишняя `}` внутри массива → три правки выполнены, модель не повторяет вызов", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const repairs: ToolInputRepair[] = [];
    const { model } = await runCall(editTool(execute), extraCloserInside, "edit_lead_magnet", (repair) => repairs.push(repair));
    expect(execute).toHaveBeenCalledOnce();
    expect((execute.mock.calls[0]![0] as { changes: unknown[] }).changes).toHaveLength(3);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(repairs[0]?.strayClosers).toEqual({ inside: 1, end: 0 });
  });

  it("после починки JSON не проходит схему → инструмент не вызван, ошибка модели как раньше, журнал молчит", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const onRepaired = vi.fn();
    const { parts } = await runCall(editTool(execute), '{"changes": [{"op": "set", "field": "name", "extra": 1}}]}', "edit_lead_magnet", onRepaired);
    expect(execute).not.toHaveBeenCalled();
    expect(parts.some((part) => part.type === "tool-call" && part.invalid === true)).toBe(true);
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("забытая `]` перед `}` → инструмент выполнен, одна запись в журнал с числом дописанных скобок", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const repairs: ToolInputRepair[] = [];
    const raw = '{"facts": ["a", "b"}';
    const { model } = await runCall(rememberTool(execute), raw, "remember", (repair) => repairs.push(repair));
    expect(execute).toHaveBeenCalledExactlyOnceWith({ facts: ["a", "b"] });
    expect(historyToolCall(model)).toMatchObject({ input: { facts: ["a", "b"] } });
    expect(repairs).toEqual([
      { toolName: "remember", inputLength: raw.length, strayClosers: { inside: 0, end: 0 }, missingClosers: 1, nestedJson: false, byApp: false, strings: false, types: false },
    ]);
  });

  it("обрыв на законченном значении: нет `]}` в конце → дописаны обе", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const repairs: ToolInputRepair[] = [];
    const raw = '{"fields": [{"fieldId": "f-1", "value": "x"}';
    await runCall(rememberTool(execute), raw, "remember", (repair) => repairs.push(repair));
    expect(execute).toHaveBeenCalledExactlyOnceWith({ fields: [{ fieldId: "f-1", value: "x" }] });
    expect(repairs[0]?.missingClosers).toBe(2);
  });

  it.each([
    ["обрыв внутри строки", '{"facts": ["a", "b'],
    ["обрыв после запятой", '{"facts": ["a", '],
    ["обрыв после двоеточия", '{"facts": '],
    ["обрыв посреди числа", '{"taskId": 12'],
  ])("%s → не чинится, ошибка как раньше", async (_name, raw) => {
    const execute = vi.fn((_input: unknown) => "ok");
    const onRepaired = vi.fn();
    const { parts } = await runCall(rememberTool(execute), raw, "remember", onRepaired);
    expect(execute).not.toHaveBeenCalled();
    expect(parts.some((part) => part.type === "tool-call" && part.invalid === true)).toBe(true);
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("скобки дописаны, но схема не прошла → инструмент не вызван, ошибка модели как раньше, журнал молчит", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const onRepaired = vi.fn();
    const { parts } = await runCall(editTool(execute), '{"changes": [{"op": "set", "field": "name", "extra": 1}}', "edit_lead_magnet", onRepaired);
    expect(execute).not.toHaveBeenCalled();
    expect(parts.some((part) => part.type === "tool-call" && part.invalid === true)).toBe(true);
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("верный вызов — починка не зовётся, в истории тот же вызов, журнал молчит", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const onRepaired = vi.fn();
    const valid = extraCloserAtEnd.slice(0, -1);
    const { model } = await runCall(rememberTool(execute), valid, "remember", onRepaired);
    expect(execute).toHaveBeenCalledExactlyOnceWith(JSON.parse(valid));
    expect(historyToolCall(model)).toMatchObject({ input: JSON.parse(valid) });
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("старые починки тоже попадают в журнал: строки и типы", async () => {
    const repairs: ToolInputRepair[] = [];
    await runCall(updateTask(() => "ok"), '{"taskId":"2","done":"true"}', "update_task", (repair) => repairs.push(repair));
    expect(repairs).toEqual([{ toolName: "update_task", inputLength: 28, strayClosers: { inside: 0, end: 0 }, missingClosers: 0, nestedJson: false, byApp: false, strings: false, types: true }]);
  });
});

describe("describeToolInputRepair", () => {
  it("строка журнала: что поправлено и длина, без содержимого аргументов", () => {
    const line = describeToolInputRepair(
      { toolName: "remember", inputLength: 237, strayClosers: { inside: 1, end: 2 }, missingClosers: 3, nestedJson: true, byApp: true, strings: true, types: true },
      { chatId: "chat-1", modelId: "deepseek-v4.1-flash", providerId: "deepseek" },
    );
    expect(line).toBe(
      "[аргументы починены] чат=chat-1 инструмент=remember модель=deepseek-v4.1-flash провайдер=deepseek " +
        "правка=лишние скобки внутри ×1, лишние скобки в конце ×2, дописаны скобки ×3, JSON из строки, записи в строках, типы по схеме, правка приложения длина=237",
    );
  });
});

/** Что модель увидит в истории на следующем шаге в ответ на кривой вызов. */
function historyToolError(model: MockLanguageModelV4): string {
  const prompt = model.doStreamCalls[1]!.prompt;
  const result = prompt.flatMap((message) => (message.role === "tool" ? message.content : [])).find((part) => part.type === "tool-result");
  return JSON.stringify((result as { output?: unknown } | undefined)?.output ?? "");
}

const looseChangesTool = (execute: (input: unknown) => unknown) =>
  ({
    edit_lead_magnet: tool({
      description: "Правка.",
      inputSchema: z.object({ changes: z.array(z.record(z.string(), z.unknown())) }),
      execute: async (input) => execute(input),
    }),
  }) as ToolSet;

describe("createRepairToolCall: JSON внутри строки и посреди объекта (прогон оценки 2026-10-19)", () => {
  it("`changes` пришёл строкой, внутри лишняя `}` перед `]` → правка выполнена массивом", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const repairs: ToolInputRepair[] = [];
    const raw = JSON.stringify({ changes: instructionExtraBraceBeforeArrayCloserChangesText });
    await runCall(editTool(execute), raw, "edit_lead_magnet", (repair) => repairs.push(repair));
    expect(execute).toHaveBeenCalledOnce();
    const changes = (execute.mock.calls[0]![0] as { changes: Array<{ op: string; field: string }> }).changes;
    expect(changes).toMatchObject([{ op: "set", field: "instruction" }]);
    expect(repairs).toEqual([
      { toolName: "edit_lead_magnet", inputLength: raw.length, strayClosers: { inside: 1, end: 0 }, missingClosers: 0, nestedJson: true, byApp: false, strings: false, types: false },
    ]);
  });

  it("`changes` строкой, лишняя `}` в конце после `]` → выполнено", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const repairs: ToolInputRepair[] = [];
    await runCall(looseChangesTool(execute), JSON.stringify({ changes: fieldsExtraBraceAtEndChangesText }), "edit_lead_magnet", (repair) => repairs.push(repair));
    expect(execute).toHaveBeenCalledOnce();
    expect(repairs[0]).toMatchObject({ nestedJson: true, strayClosers: { inside: 0, end: 1 } });
  });

  it("`changes` строкой, забыта `]` в конце → выполнено", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const repairs: ToolInputRepair[] = [];
    await runCall(looseChangesTool(execute), JSON.stringify({ changes: flowMissingArrayCloserChangesText }), "edit_lead_magnet", (repair) => repairs.push(repair));
    expect(execute).toHaveBeenCalledOnce();
    expect(repairs[0]).toMatchObject({ nestedJson: true, missingClosers: 1 });
  });

  it("строка в поле-строке с JSON внутри остаётся строкой", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const tools = {
      note: tool({ description: "Заметка.", inputSchema: z.object({ text: z.string() }), execute: async (input) => execute(input) }),
    } as ToolSet;
    await runCall(tools, JSON.stringify({ text: '{"a": 1}}' }), "note");
    expect(execute).toHaveBeenCalledExactlyOnceWith({ text: '{"a": 1}}' });
  });

  it("лишняя `}` посреди объекта (не в конце) → выполнено", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const tools = {
      plan: tool({
        description: "План.",
        inputSchema: z.object({ owner: z.object({ id: z.number() }), title: z.string() }),
        execute: async (input) => execute(input),
      }),
    } as ToolSet;
    const repairs: ToolInputRepair[] = [];
    await runCall(tools, '{"owner": {"id": 1}}, "title": "x"}', "plan", (repair) => repairs.push(repair));
    expect(execute).toHaveBeenCalledExactlyOnceWith({ owner: { id: 1 }, title: "x" });
    expect(repairs[0]?.strayClosers).toEqual({ inside: 1, end: 0 });
  });
});

describe("createRepairToolCall: короткая ошибка модели", () => {
  const bulky = "ЗЗЗ".repeat(300);

  it("JSON не чинится → 1–2 строки: что не так, около какой позиции и кусок текста; аргументов целиком нет", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const raw = `{"facts": ["${bulky}", "обрыв`;
    const { model } = await runCall(rememberTool(execute), raw, "remember");
    expect(execute).not.toHaveBeenCalled();
    const message = historyToolError(model);
    expect(message).toContain("не разбираются как JSON");
    expect(message).toMatch(/позици/);
    expect(message).toContain("пришли вызов заново");
    expect(message).not.toContain(bulky);
    expect(message.length).toBeLessThan(400);
  });

  it("лишняя скобка, которую не починить, → ошибка называет скобку и позицию", async () => {
    const { model } = await runCall(rememberTool(() => "ok"), '{"facts": ["a"]} }} }} x', "remember");
    expect(historyToolError(model)).toMatch(/`\}`.*позици/);
  });

  it("ошибка схемы → коротко какие поля не так, без аргументов целиком", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const raw = JSON.stringify({ changes: [{ op: "set", field: "name", value: bulky, extra: 1 }] });
    const { model } = await runCall(editTool(execute), raw, "edit_lead_magnet");
    expect(execute).not.toHaveBeenCalled();
    const message = historyToolError(model);
    expect(message).toContain("changes");
    expect(message).toMatch(/extra/);
    expect(message).not.toContain(bulky);
    expect(message.length).toBeLessThan(500);
  });

  it("после починки схема не прошла → ошибка короткая, аргументов целиком нет", async () => {
    const execute = vi.fn((_input: unknown) => "ok");
    const raw = `{"changes": [{"op": "set", "field": "name", "value": "${bulky}", "extra": 1}}`;
    const { model } = await runCall(editTool(execute), raw, "edit_lead_magnet");
    expect(execute).not.toHaveBeenCalled();
    const message = historyToolError(model);
    expect(message).not.toContain(bulky);
    expect(message.length).toBeLessThan(500);
  });
});

describe("createRepairToolCall: repairToolInput приложения", () => {
  it("не зовётся, если встроенная починка справилась", async () => {
    const repairToolInput = vi.fn(() => undefined);
    const execute = vi.fn((_input: unknown) => "ok");
    await runCall(rememberTool(execute), extraCloserAtEnd, "remember", undefined, repairToolInput);
    expect(execute).toHaveBeenCalledOnce();
    expect(repairToolInput).not.toHaveBeenCalled();
  });

  it("зовётся с именем инструмента, текстом и ошибкой; починенный текст проходит схему → выполнено, в журнале byApp", async () => {
    const repairs: ToolInputRepair[] = [];
    const execute = vi.fn((_input: unknown) => "ok");
    const raw = '{"facts": ["a", "b';
    const repairToolInput = vi.fn(async ({ text }: { toolName: string; text: string; error: unknown }) => text + '"]}');
    await runCall(rememberTool(execute), raw, "remember", (repair) => repairs.push(repair), repairToolInput);
    expect(repairToolInput).toHaveBeenCalledOnce();
    expect(repairToolInput.mock.calls[0]![0]).toMatchObject({ toolName: "remember", text: raw });
    expect((repairToolInput.mock.calls[0]![0] as { error: unknown }).error).toBeInstanceOf(Error);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ facts: ["a", "b"] });
    expect(repairs[0]).toMatchObject({ toolName: "remember", byApp: true });
  });

  it("приложение вернуло текст, который не проходит схему → инструмент не вызван, журнал молчит", async () => {
    const onRepaired = vi.fn();
    const execute = vi.fn((_input: unknown) => "ok");
    await runCall(rememberTool(execute), '{"facts": ["a", "b', "remember", onRepaired, () => '{"facts": 5}');
    expect(execute).not.toHaveBeenCalled();
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("приложение вернуло undefined или упало → ошибка модели как раньше, ход не падает", async () => {
    for (const hook of [() => undefined, () => { throw new Error("сбой"); }]) {
      const execute = vi.fn((_input: unknown) => "ok");
      const { parts } = await runCall(rememberTool(execute), '{"facts": ["a", "b', "remember", undefined, hook);
      expect(execute).not.toHaveBeenCalled();
      expect(parts.some((part) => part.type === "tool-call" && part.invalid === true)).toBe(true);
    }
  });

  it("приложение может взять за основу встроенный починщик", async () => {
    const { repairToolArguments } = await import("../../../src/agent-run/tool-arguments-repair");
    const execute = vi.fn((_input: unknown) => "ok");
    await runCall(rememberTool(execute), '{"facts": ["a"]} }}', "remember", undefined, ({ text }) => repairToolArguments(text.replace(/\s*\}\}$/, "")));
    expect(execute).toHaveBeenCalledOnce();
  });
});
