import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineWidget } from "../../src/widgets/define-widget";
import { createAgentWidgets } from "../../src/widgets/widget-tools";
import type { AgentWidgetSettings, WidgetSetInput } from "../../src/widgets/widget-types";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { LongTermMemory } from "../../src/memory/long-term-memory";
import { generateResult, readAll } from "./support/mock-model";
import { CHOICE_INPUT, answerAndFinish, step, userMessage, widgetCall, widgetChat } from "./support/widget-chat";
import type { WidgetChatSetup } from "./support/widget-chat";

const pickSlot = defineWidget({
  name: "pick_slot",
  description: "Выбрать время встречи",
  inputSchema: z.object({ slots: z.array(z.string()) }),
  answerSchema: z.object({ slot: z.string() }),
});

/** Форма «a» — только выбор варианта, форма «b» — только время встречи; без формы — все. */
const byForm = (input: WidgetSetInput): string[] => {
  const form = input.chat.data?.form;
  if (form === "a") return ["ask_choice"];
  if (form === "b") return ["pick_slot"];
  return ["ask_choice", "ask_rating", "pick_slot"];
};

const settings = (enabledFor: AgentWidgetSettings["enabledFor"] = byForm): AgentWidgetSettings => ({ basic: ["ask_choice", "ask_rating"], custom: [pickSlot], enabledFor });

const toolNames = (chat: ReturnType<typeof widgetChat>, call: number) => (chat.model.doStreamCalls[call]!.tools ?? []).map((entry) => entry.name);
const promptOf = (chat: ReturnType<typeof widgetChat>, call: number) => JSON.stringify(chat.model.doStreamCalls[call]!.prompt);

async function chatWith(data: Record<string, unknown> | undefined, scripts: Parameters<typeof widgetChat>[0] = [], setup: WidgetChatSetup = {}) {
  const chat = widgetChat(scripts, { widgets: settings(), ...setup });
  const created = await chat.service.createChat("anna", data ? { data } : undefined);
  return { ...chat, chatId: created.id };
}

describe("agent.widgets.enabledFor: набор виджетов по чату", () => {
  it("модель видит только включённые виджеты; инструменты приложения на месте", async () => {
    const find = tool({ description: "Найти", inputSchema: z.object({ q: z.string() }), execute: async () => "нашёл" });
    const formA = await chatWith({ form: "a" }, [], { agent: { tools: { find } } });
    await readAll(await formA.service.sendMessage("anna", formA.chatId, userMessage("u1", "привет")));
    expect(toolNames(formA, 0)).toEqual(["ask_choice", "find"]);

    const formB = await chatWith({ form: "b" });
    await readAll(await formB.service.sendMessage("anna", formB.chatId, userMessage("u1", "привет")));
    expect(toolNames(formB, 0)).toEqual(["pick_slot"]);
  });

  it("функция получает чат: id, владельца и данные; у чата объекта — subject", async () => {
    const enabledFor = vi.fn((_input: WidgetSetInput) => ["ask_choice"]);
    const chat = widgetChat([], { widgets: settings(enabledFor) });
    const created = await chat.service.createChat("anna", { data: { form: "a" } });
    await readAll(await chat.service.sendMessage("anna", created.id, userMessage("u1", "привет")));
    expect(enabledFor).toHaveBeenCalledWith({ chat: { id: created.id, ownerId: "anna", data: { form: "a" } } });

    const { chat: opened } = await chat.service.openSubjectChat({ ownerId: "anna", key: "lesson-7", data: { level: 2 } });
    await readAll(await chat.service.sendMessage("anna", opened.id, userMessage("u2", "привет")));
    expect(enabledFor).toHaveBeenLastCalledWith({ chat: expect.objectContaining({ id: opened.id, subject: { key: "lesson-7", data: { level: 2 } } }) });
  });

  it("набор стабилен между ходами, пока данные чата те же; сменились данные — сменился набор", async () => {
    const chat = await chatWith({ form: "a" });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "раз")));
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u2", "два")));
    expect(chat.model.doStreamCalls[1]!.tools).toEqual(chat.model.doStreamCalls[0]!.tools);
    await chat.service.updateChatData("anna", chat.chatId, { form: "b" });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u3", "три")));
    expect(toolNames(chat, 2)).toEqual(["pick_slot"]);
  });

  it("набор один на все запросы хода: продолжение после ответа на виджет — те же инструменты", async () => {
    const chat = await chatWith({ form: "a" }, [step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "помоги")));
    await answerAndFinish(chat.service, chat.chatId, "w1", { выбрано: "Про" });
    expect(chat.model.doStreamCalls[1]!.tools).toEqual(chat.model.doStreamCalls[0]!.tools);
  });

  it("прошлый вызов выключенного виджета идёт модели текстом, а не вызовом: строгий провайдер его примет", async () => {
    const chat = await chatWith({ form: "a" }, [step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "помоги")));
    await answerAndFinish(chat.service, chat.chatId, "w1", { выбрано: "Про" });
    await chat.service.updateChatData("anna", chat.chatId, { form: "b" });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u2", "дальше")));

    const prompt = chat.model.doStreamCalls[2]!.prompt;
    const parts = prompt.flatMap((message) => (Array.isArray(message.content) ? (message.content as Array<{ type: string }>) : []));
    expect(parts.some((part) => part.type === "tool-call" || part.type === "tool-result")).toBe(false);
    expect(prompt.some((message) => message.role === "tool")).toBe(false);
    const text = JSON.stringify(prompt);
    expect(text).toContain("ask_choice");
    expect(text).toContain("Про");
    // Тот же набор и та же история — тот же запрос (кэш).
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u3", "ещё")));
    expect(promptOf(chat, 3).startsWith(promptOf(chat, 2).slice(0, -2))).toBe(true);
  });

  it("включённый виджет в истории остаётся вызовом", async () => {
    const chat = await chatWith({ form: "a" }, [step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "помоги")));
    await answerAndFinish(chat.service, chat.chatId, "w1", { выбрано: "Про" });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u2", "дальше")));
    expect(chat.model.doStreamCalls[2]!.prompt.some((message) => message.role === "tool")).toBe(true);
  });

  it("неизвестное имя — строка в журнал, пропускается; бросок функции — ошибка хода", async () => {
    const typo = await chatWith(undefined, [], { widgets: settings(() => ["ask_choise", "ask_choice"]) });
    await readAll(await typo.service.sendMessage("anna", typo.chatId, userMessage("u1", "привет")));
    expect(toolNames(typo, 0)).toEqual(["ask_choice"]);
    expect(typo.logError).toHaveBeenCalledWith(expect.stringContaining("ask_choise"));

    const broken = await chatWith(undefined, [], {
      widgets: settings(() => {
        throw new Error("нет формы");
      }),
    });
    const chunks = await readAll(await broken.service.sendMessage("anna", broken.chatId, userMessage("u1", "привет")));
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(true);
    expect(broken.model.doStreamCalls).toHaveLength(0);
  });

  it("неизвестное имя в журнал — экранировано; строк не больше предела, сколько бы имён ни пришло", async () => {
    const many = Array.from({ length: 300 }, (_, index) => `x${index}`);
    const chat = await chatWith(undefined, [], { widgets: settings(() => ["bad\nname", ...many]) });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "привет")));
    const lines = chat.logError.mock.calls.map(([line]) => line).filter((line) => line.includes("enabledFor"));
    expect(lines.some((line) => line.includes('"bad\\nname"'))).toBe(true);
    expect(lines.every((line) => !line.includes("bad\nname"))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(101);
  });

  it("enabledFor не функция — ошибка при создании службы", () => {
    expect(() => createAgentWidgets({ basic: true, enabledFor: ["ask_choice"] as never })).toThrow(/enabledFor/);
  });

  it("повтор имени виджета с памятью или фоном — ошибка при создании службы и с enabledFor", () => {
    const memory = { instructions: "Память.", toolNames: ["ask_choice"], tools: () => ({}), snapshot: async () => null } as unknown as LongTermMemory;
    expect(() => widgetChat([], { widgets: settings(), service: { memory } })).toThrow(/ask_choice/);
    expect(() => widgetChat([], { widgets: { basic: true }, service: { memory } })).toThrow(/ask_choice/);
    const background = { instructions: "Фон.", toolNames: ["pick_slot"], tools: () => ({}) } as never;
    expect(() => widgetChat([], { widgets: settings(), service: { background } })).toThrow(/pick_slot/);
  });
});

describe("enabledFor: ждущий вызов, базовые виджеты, сжатие и помощники", () => {
  it("виджет выключили, пока его вызов ждал ответа: ответ принят, продолжение видит прошлый вызов текстом", async () => {
    const chat = await chatWith({ form: "a" }, [step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "помоги")));
    await chat.service.updateChatData("anna", chat.chatId, { form: "b" });
    const result = await answerAndFinish(chat.service, chat.chatId, "w1", { выбрано: "Про" });
    expect(result.resumed).toBe(true);
    expect(toolNames(chat, 1)).toEqual(["pick_slot"]);
    expect(chat.model.doStreamCalls[1]!.prompt.some((message) => message.role === "tool")).toBe(false);
    expect(promptOf(chat, 1)).toContain("Про");
  });

  it("базовые виджеты и suggest_replies выключаются так же; прошлые подсказки идут модели текстом", async () => {
    const all = (input: WidgetSetInput) => (input.chat.data?.off ? [] : ["ask_choice", "ask_multi_choice", "ask_rating", "ask_form", "suggest_replies"]);
    const chat = await chatWith(undefined, [step(widgetCall("s1", "suggest_replies", { replies: ["Да", "Нет"] }))], { widgets: { basic: true, enabledFor: all } });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "привет")));
    expect(toolNames(chat, 0)).toEqual(["ask_choice", "ask_form", "ask_multi_choice", "ask_rating", "suggest_replies"]);
    await chat.service.updateChatData("anna", chat.chatId, { off: true });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u2", "дальше")));
    const last = chat.model.doStreamCalls.length - 1;
    expect(toolNames(chat, last)).toEqual([]);
    expect(chat.model.doStreamCalls[last]!.prompt.some((message) => message.role === "tool")).toBe(false);
    expect(promptOf(chat, last)).toContain("suggest_replies");
  });

  it("сжатие истории: выключенный виджет не среди инструментов, его вызов — текстом", async () => {
    const sized = (parts: LanguageModelV4StreamPart[], context: number): LanguageModelV4StreamPart[] => [
      ...parts.slice(0, -1),
      {
        ...(parts.at(-1) as Extract<LanguageModelV4StreamPart, { type: "finish" }>),
        usage: { inputTokens: { total: context - 10, noCache: context - 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
      },
    ];
    const textStep = (text: string): LanguageModelV4StreamPart[] => [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: text },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
    ];
    const chat = await chatWith(
      { form: "a" },
      [sized(step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), 50), sized(textStep("выбрали"), 100), sized(textStep("второй"), 300), sized(textStep("третий"), 600)],
      { service: { compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 } } },
    );
    const summaries: LanguageModelV4CallOptions[] = [];
    chat.model.doGenerate = async (options) => {
      summaries.push(options);
      return generateResult("## Цель\nсводка", { output: 20 }) as never;
    };
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "помоги")));
    await answerAndFinish(chat.service, chat.chatId, "w1", { выбрано: "Про" });
    await chat.service.updateChatData("anna", chat.chatId, { form: "b" });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u2", "два")));
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u3", "три")));
    await vi.waitFor(async () => expect((await chat.service.getCompactions("anna", chat.chatId)).compactions.length).toBeGreaterThan(0));
    const request = summaries.at(-1)!;
    expect((request.tools ?? []).map((entry) => entry.name)).toEqual(["pick_slot"]);
    expect(request.prompt.some((message) => message.role === "tool")).toBe(false);
    expect(JSON.stringify(request.prompt)).toContain("Про");
  });

  it("помощник: виджетов не видит, ход с выключенным виджетом в истории идёт как обычно", async () => {
    const chat = await chatWith({ form: "a" }, [step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), [], step(widgetCall("h1", "helper_research", { task: "узнай" }))], {
      agent: { helpers: { research: { description: "Исследует", instructions: "Ты исследователь.", model: { modelId: "mock-model", providerId: "mock" } } } },
    });
    const helperCalls: LanguageModelV4CallOptions[] = [];
    chat.model.doGenerate = async (options) => {
      helperCalls.push(options);
      return generateResult("нашёл") as never;
    };
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u1", "помоги")));
    await answerAndFinish(chat.service, chat.chatId, "w1", { выбрано: "Про" });
    await chat.service.updateChatData("anna", chat.chatId, { form: "b" });
    await readAll(await chat.service.sendMessage("anna", chat.chatId, userMessage("u2", "спроси помощника")));
    expect(helperCalls).toHaveLength(1);
    expect((helperCalls[0]!.tools ?? []).map((entry) => entry.name)).toEqual([]);
    expect(JSON.stringify(helperCalls[0]!.prompt)).not.toContain("ask_choice");
    const last = chat.model.doStreamCalls.length - 1;
    expect(toolNames(chat, last)).toEqual(["helper_research", "pick_slot"]);
    expect(chat.model.doStreamCalls[last]!.prompt.filter((message) => message.role === "tool")).toHaveLength(1);
    expect(promptOf(chat, last)).toContain("нашёл");
  });
});
