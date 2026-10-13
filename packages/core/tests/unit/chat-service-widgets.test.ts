import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ChatNotFoundError, InvalidWidgetAnswerError, WidgetNotPendingError } from "../../src/chat-service";
import { ChatBusyError } from "../../src/running-answers/running-answer-registry";
import { SpendingLimitReachedError } from "../../src/spending/spending-limits";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { defineWidget } from "../../src/widgets/define-widget";
import { ONE_QUESTION_AT_A_TIME } from "../../src/widgets/pending-widgets";
import { readAll, withoutFrozenContext } from "./support/mock-model";
import {
  CHOICE_INPUT,
  answerAndFinish,
  ask,
  lastAnswer,
  promptText,
  removeTool,
  step,
  toolPart,
  widgetCall,
  widgetChat,
} from "./support/widget-chat";

const pickSlot = defineWidget({
  name: "pick_slot",
  description: "Выбрать время встречи",
  inputSchema: z.object({ slots: z.array(z.string()).min(2) }),
  answerSchema: z.object({ slot: z.string() }),
});

describe("виджеты в настройке агента", () => {
  it("инструменты виджетов идут в запрос рядом с инструментами приложения, по имени", async () => {
    const find = tool({ description: "Найти", inputSchema: z.object({ q: z.string() }), execute: async () => "ок" });
    const { service, model } = widgetChat([], { widgets: { basic: ["suggest_replies", "ask_choice"], custom: [pickSlot] }, agent: { tools: { find } } });
    await ask(service);
    expect(model.doStreamCalls[0]!.tools!.map((entry) => entry.name)).toEqual(["ask_choice", "find", "pick_slot", "suggest_replies"]);
  });

  it("имя виджета совпало с инструментом приложения или браузерным — исключение при создании службы", () => {
    const { build } = widgetChat([]);
    const clashing = tool({ description: "Свой выбор", inputSchema: z.object({}) });
    expect(() => build(undefined, { tools: { ask_choice: clashing } })).toThrow(/ask_choice/);
    expect(() => build(undefined, { browserTools: { ask_rating: clashing } })).toThrow(/ask_rating/);
  });

  it("совпадение с инструментом из функции — ошибка хода", async () => {
    const clashing = tool({ description: "Свой выбор", inputSchema: z.object({}) });
    const { service, logError } = widgetChat([], { agent: { tools: () => ({ ask_choice: clashing }) } });
    const { chat } = await ask(service);
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("error");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("ask_choice"));
  });
});

describe("ход с виджетом", () => {
  it("вызов ждущего виджета ставит ход на паузу: ответ ждёт человека, вызов без результата", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat, chunks } = await ask(service);
    expect(model.doStreamCalls).toHaveLength(1);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("awaiting_approval");
    expect(toolPart(answer, "w1")).toMatchObject({ type: "tool-ask_choice", state: "input-available", input: CHOICE_INPUT });
    expect(chunks.some((chunk) => chunk.type === "message-metadata" && (chunk.messageMetadata as { status?: string } | undefined)?.status === "awaiting_approval")).toBe(true);
    expect((await service.getHistory("anna", chat.id)).running).toBe(false);
  });

  it("негодный вход — ошибка вызова с причиной, модель видит её и ход идёт дальше", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", { question: "?", options: ["один"] }))]);
    const { chat } = await ask(service);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("complete");
    const part = toolPart(answer, "w1")!;
    expect(part.state).toBe("output-error");
    expect(part.errorText).toMatch(/options/);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(promptText(model, 1)).toContain("options");
  });

  it("второй ждущий вызов в шаге — ошибка «Задавай один вопрос за раз», ход ждёт первого", async () => {
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT), widgetCall("w2", "ask_rating", { question: "Оцените", scale: "stars" }))]);
    const { chat } = await ask(service);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("awaiting_approval");
    expect(toolPart(answer, "w1")).toMatchObject({ state: "input-available" });
    expect(toolPart(answer, "w2")).toMatchObject({ state: "output-error", errorText: ONE_QUESTION_AT_A_TIME });
  });

  it("подсказки не ставят ход на паузу: результат «показано», ход идёт дальше", async () => {
    const { service, model } = widgetChat([step(widgetCall("s1", "suggest_replies", { replies: ["Да", "Нет"] }))]);
    const { chat } = await ask(service);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("complete");
    expect(toolPart(answer, "s1")).toMatchObject({ state: "output-available", output: "показано" });
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("инструмент приложения без execute — не виджет: ход, как в 0.15, кончается законченным ответом", async () => {
    const external = tool({ description: "Снаружи", inputSchema: z.object({}) });
    const { service } = widgetChat([step(widgetCall("x1", "external", {}))], { widgets: undefined, agent: { widgets: undefined, tools: { external } } });
    const { chat } = await ask(service);
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });
});

describe("answerWidget", () => {
  it("ответ принят: вызов получает короткий результат, ход продолжается в том же сообщении", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const before = await lastAnswer(service, chat.id);
    const result = await service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } });
    expect(result).toEqual({ resumed: true });
    const chunks = await readAll((await service.subscribe("anna", chat.id))!);
    expect(chunks[0]).toMatchObject({ type: "start", messageId: before.id });
    const after = await lastAnswer(service, chat.id);
    expect(after.id).toBe(before.id);
    expect(after.metadata?.status).toBe("complete");
    expect(toolPart(after, "w1")).toMatchObject({ state: "output-available", output: { выбрано: "Про" } });
    expect(after.parts.at(-1)).toMatchObject({ type: "text", text: "Готово" });
    const toolMessage = model.doStreamCalls[1]!.prompt.find((message) => message.role === "tool")!;
    expect(JSON.stringify(toolMessage.content)).toContain(JSON.stringify({ выбрано: "Про" }));
    expect(JSON.stringify(toolMessage.content)).not.toContain("Какой тариф");
  });

  it("свой виджет — по answerSchema", async () => {
    const { service } = widgetChat([step(widgetCall("p1", "pick_slot", { slots: ["10:00", "11:00"] }))], { widgets: { custom: [pickSlot] } });
    const { chat } = await ask(service);
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "p1", answer: { slot: 10 } })).rejects.toBeInstanceOf(InvalidWidgetAnswerError);
    await answerAndFinish(service, chat.id, "p1", { slot: "11:00" });
    expect(toolPart(await lastAnswer(service, chat.id), "p1")).toMatchObject({ state: "output-available", output: { slot: "11:00" } });
  });

  it("чужой чат — ChatNotFoundError", async () => {
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "boris", toolCallId: "w1", answer: { выбрано: "Про" } })).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("нет такого вызова или уже отвечен — WidgetNotPendingError", async () => {
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "нет", answer: { выбрано: "Про" } })).rejects.toBeInstanceOf(WidgetNotPendingError);
    await answerAndFinish(service, chat.id, "w1", { выбрано: "Про" });
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Базовый" } })).rejects.toBeInstanceOf(WidgetNotPendingError);
  });

  it("на подсказки не отвечают — WidgetNotPendingError", async () => {
    const { service } = widgetChat([step(widgetCall("s1", "suggest_replies", { replies: ["Да"] }), widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "s1", answer: "Да" })).rejects.toBeInstanceOf(WidgetNotPendingError);
  });

  it("ответ вне схемы или JSON больше 16 КБ — InvalidWidgetAnswerError, ничего не записано", async () => {
    const { service, storage } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const before = await lastAnswer(service, chat.id);
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Макс" } })).rejects.toBeInstanceOf(InvalidWidgetAnswerError);
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "я".repeat(9000) } })).rejects.toBeInstanceOf(InvalidWidgetAnswerError);
    const stored = await storage.getMessage(before.id);
    expect(stored?.status).toBe("awaiting_approval");
    expect(withoutFrozenContext(stored?.parts ?? [])).toEqual(before.parts);
  });

  it("виджета больше нет в настройках — WidgetNotPendingError: ответить можно только сообщением", async () => {
    const { service, storage, build } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const withoutChoice = build(storage, { widgets: { basic: ["ask_rating"] } });
    await expect(withoutChoice.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).rejects.toBeInstanceOf(WidgetNotPendingError);
    const withoutWidgets = build(storage, { widgets: undefined });
    await expect(withoutWidgets.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).rejects.toBeInstanceOf(WidgetNotPendingError);
  });

  it("два ответа сразу в одной копии: принят один, второй — ChatBusyError", async () => {
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const answers = await Promise.allSettled([
      service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } }),
      service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Базовый" } }),
    ]);
    expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(1);
    const rejected = answers.find((answer) => answer.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ChatBusyError);
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(toolPart(await lastAnswer(service, chat.id), "w1")).toMatchObject({ output: { выбрано: "Про" } });
  });

  it("лимит расходов — отказ, виджет ждёт дальше", async () => {
    const state = { blocked: false };
    const limits: SpendingLimits = {
      assertWithinLimit: vi.fn(async () => {
        if (state.blocked) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      }),
      status: vi.fn(async () => ({ state: "ok" as const })),
    };
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))], { service: { limits } });
    const { chat } = await ask(service);
    state.blocked = true;
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).rejects.toBeInstanceOf(SpendingLimitReachedError);
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("awaiting_approval");
    state.blocked = false;
    await answerAndFinish(service, chat.id, "w1", { выбрано: "Про" });
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });

  it("виджет вместе с запросом подтверждения: ход ждёт обоих", async () => {
    const remove = removeTool();
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT), { type: "tool-call", toolCallId: "r1", toolName: "remove", input: JSON.stringify({ path: "a" }) })], {
      agent: { tools: { remove } },
    });
    const { chat } = await ask(service);
    const waiting = await lastAnswer(service, chat.id);
    expect(waiting.metadata?.status).toBe("awaiting_approval");
    expect(await service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).toEqual({ resumed: false });
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("awaiting_approval");
    expect(toolPart(await lastAnswer(service, chat.id), "w1")).toMatchObject({ state: "output-available" });
    const approvalId = (toolPart(waiting, "r1") as unknown as { approval: { id: string } }).approval.id;
    expect(await service.answerApproval("anna", chat.id, approvalId, "allow")).toEqual({ resumed: true });
    await readAll((await service.subscribe("anna", chat.id))!);
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });

  it("подтверждение раньше виджета: после решения ход ждёт виджет", async () => {
    const remove = removeTool();
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT), { type: "tool-call", toolCallId: "r1", toolName: "remove", input: JSON.stringify({ path: "a" }) })], {
      agent: { tools: { remove } },
    });
    const { chat } = await ask(service);
    const approvalId = (toolPart(await lastAnswer(service, chat.id), "r1") as unknown as { approval: { id: string } }).approval.id;
    expect(await service.answerApproval("anna", chat.id, approvalId, "allow")).toEqual({ resumed: false });
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("awaiting_approval");
    expect(await answerAndFinish(service, chat.id, "w1", { выбрано: "Про" })).toEqual({ resumed: true });
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });
});
