import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ChatNotFoundError, InvalidWidgetAnswerError, WidgetNotPendingError } from "../../src/chat-service";
import { ChatClosedError } from "../../src/access/chat-closure";
import { APP_STATE_PART_TYPE } from "../../src/app-state/app-state";
import { TurnRefusedError } from "../../src/turn-hooks/turn-hooks";
import { defineWidget } from "../../src/widgets/define-widget";
import { WidgetAnswerCheckAbortedError, WidgetAnswerCheckTimeoutError, WidgetAnswerRefusedError } from "../../src/widgets/widget-answer-check";
import { createAgentWidgets } from "../../src/widgets/widget-tools";
import type { WidgetAnswerContext, WidgetAnswerVerdict } from "../../src/widgets/widget-types";
import { readAll, withoutFrozenContext } from "./support/mock-model";
import { CHOICE_INPUT, answerAndFinish, lastAnswer, promptText, step, toolPart, userMessage, widgetCall, widgetChat } from "./support/widget-chat";
import type { WidgetChatSetup } from "./support/widget-chat";

const SLOT_INPUT = { slots: ["10:00", "11:00"] };
const slotAnswer = { slot: "11:00" };

type SlotCheck = (answer: { slot: string }, ctx: WidgetAnswerContext<{ slots: string[] }>) => WidgetAnswerVerdict<{ slot: string }> | Promise<WidgetAnswerVerdict<{ slot: string }>>;

const pickSlotWith = (checkAnswer?: SlotCheck) =>
  defineWidget({
    name: "pick_slot",
    description: "Выбрать время встречи",
    inputSchema: z.object({ slots: z.array(z.string()).min(2) }),
    answerSchema: z.object({ slot: z.string() }),
    ...(checkAnswer && { checkAnswer }),
  });

/** Чат с ждущим `pick_slot` (вызов `p1`) и проверкой ответа. */
async function waitingSlot(checkAnswer: SlotCheck | undefined, setup: WidgetChatSetup = {}, scripts = [step(widgetCall("p1", "pick_slot", SLOT_INPUT))]) {
  const chat = widgetChat(scripts, { widgets: { custom: [pickSlotWith(checkAnswer)] }, ...setup });
  const created = await chat.service.createChat("anna", { data: { formId: "f1" } });
  await readAll(await chat.service.sendMessage("anna", created.id, userMessage("u1", "запишите меня")));
  return { ...chat, chatId: created.id };
}

const answerSlot = (chat: { service: { answerWidget: (request: never) => Promise<{ resumed: boolean }> }; chatId: string }, answer: unknown = slotAnswer, toolCallId = "p1") =>
  chat.service.answerWidget({ chatId: chat.chatId, ownerId: "anna", toolCallId, answer } as never);

const stateParts = (message: { parts: readonly { type: string }[] }) => message.parts.filter((part) => part.type === APP_STATE_PART_TYPE);

describe("checkAnswer у своего виджета", () => {
  it("зовётся после схемы с принятым ответом и контекстом; пустой исход — принять как есть", async () => {
    const check = vi.fn<SlotCheck>(async () => undefined);
    const chat = await waitingSlot(check);
    const waiting = await lastAnswer(chat.service, chat.chatId);
    await answerAndFinish(chat.service, chat.chatId, "p1", slotAnswer);
    expect(check).toHaveBeenCalledTimes(1);
    const [answer, ctx] = check.mock.calls[0]!;
    expect(answer).toEqual(slotAnswer);
    expect(ctx).toMatchObject({
      ownerId: "anna",
      chatId: chat.chatId,
      messageId: waiting.id,
      toolName: "pick_slot",
      toolCallId: "p1",
      input: SLOT_INPUT,
      chatData: { formId: "f1" },
    });
    expect(typeof ctx.state.set).toBe("function");
    expect(toolPart(await lastAnswer(chat.service, chat.chatId), "p1")).toMatchObject({ state: "output-available", output: slotAnswer });
  });

  it("у чата объекта в контексте есть subject", async () => {
    const check = vi.fn<SlotCheck>(async () => undefined);
    const chat = widgetChat([step(widgetCall("p1", "pick_slot", SLOT_INPUT))], { widgets: { custom: [pickSlotWith(check)] } });
    const { chat: opened } = await chat.service.openSubjectChat({ ownerId: "anna", key: "lesson-7", data: { level: 2 } });
    await readAll(await chat.service.sendMessage("anna", opened.id, userMessage("u1", "запишите меня")));
    await answerAndFinish(chat.service, opened.id, "p1", slotAnswer);
    expect(check.mock.calls[0]![1].subject).toEqual({ key: "lesson-7", data: { level: 2 } });
  });

  it("отказ: WidgetAnswerRefusedError с текстом, ничего не записано, виджет открыт, ход не идёт; повтор принимается", async () => {
    const busy = new Set(["11:00"]);
    const chat = await waitingSlot(async (answer) => (busy.has(answer.slot) ? { refuse: "Это время уже заняли. Выберите другое." } : undefined));
    const before = await lastAnswer(chat.service, chat.chatId);
    const refused = await answerSlot(chat).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(WidgetAnswerRefusedError);
    expect((refused as WidgetAnswerRefusedError).message).toBe("Это время уже заняли. Выберите другое.");
    const stored = await chat.storage.getMessage(before.id);
    expect(stored?.status).toBe("awaiting_approval");
    expect(withoutFrozenContext(stored?.parts ?? [])).toEqual(before.parts);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(chat.logError).toHaveBeenCalledWith(`[виджет] отказ answer_refused чат=${chat.chatId} вызов=p1`);

    await answerAndFinish(chat.service, chat.chatId, "p1", { slot: "10:00" });
    expect(toolPart(await lastAnswer(chat.service, chat.chatId), "p1")).toMatchObject({ state: "output-available", output: { slot: "10:00" } });
  });

  it("текст отказа: пробелы по краям срезаются, длиннее 300 знаков режется; пустой текст — ошибка приложения", async () => {
    const texts = ["  Занято, выберите другое \n", "я".repeat(400), "   "];
    let next = 0;
    const chat = await waitingSlot(async () => ({ refuse: texts[next++]! }));
    expect(((await answerSlot(chat).catch((error: unknown) => error)) as Error).message).toBe("Занято, выберите другое");
    const long = ((await answerSlot(chat).catch((error: unknown) => error)) as Error).message;
    expect(Array.from(long)).toHaveLength(300);
    const empty = await answerSlot(chat).catch((error: unknown) => error);
    expect(empty).toBeInstanceOf(TypeError);
    expect(empty).not.toBeInstanceOf(WidgetAnswerRefusedError);
    expect((await chat.storage.getMessage((await lastAnswer(chat.service, chat.chatId)).id))?.status).toBe("awaiting_approval");
  });

  it("замена ответа: в результате вызова и в запросе к модели — подменённый ответ", async () => {
    const chat = await waitingSlot(async (answer) => ({ answer: { ...answer, holdId: "h-1" } as { slot: string } }));
    await answerAndFinish(chat.service, chat.chatId, "p1", slotAnswer);
    expect(toolPart(await lastAnswer(chat.service, chat.chatId), "p1")).toMatchObject({ output: { slot: "11:00", holdId: "h-1" } });
    const toolMessage = chat.model.doStreamCalls[1]!.prompt.find((message) => message.role === "tool")!;
    expect(JSON.stringify(toolMessage.content)).toContain(JSON.stringify({ slot: "11:00", holdId: "h-1" }));
  });

  it("замена длиннее 16 КБ — ошибка приложения, ничего не записано", async () => {
    const chat = await waitingSlot(async () => ({ answer: { slot: "я".repeat(9000) } }));
    const failed = await answerSlot(chat).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(WidgetAnswerRefusedError);
    expect((await chat.storage.getMessage((await lastAnswer(chat.service, chat.chatId)).id))?.status).toBe("awaiting_approval");
  });

  it("ctx.state: записи ложатся в ответ после результата вызова, getChatState и следующий ход их видят", async () => {
    const chat = await waitingSlot(async (answer, ctx) => {
      expect(ctx.state.get("booking")).toBeUndefined();
      ctx.state.set("booking.holdId", "h-1");
      ctx.state.set("booking.start", answer.slot);
      return { answer: { ...answer, holdId: "h-1" } as { slot: string } };
    });
    await answerAndFinish(chat.service, chat.chatId, "p1", slotAnswer);
    const answer = await lastAnswer(chat.service, chat.chatId);
    expect(stateParts(answer)).toEqual([
      { type: APP_STATE_PART_TYPE, data: { set: { "booking.holdId": "h-1" } } },
      { type: APP_STATE_PART_TYPE, data: { set: { "booking.start": "11:00" } } },
    ]);
    expect(answer.parts.findIndex((part) => part.type === APP_STATE_PART_TYPE)).toBeGreaterThan(answer.parts.findIndex((part) => (part as { toolCallId?: string }).toolCallId === "p1"));
    expect(await chat.service.getChatState("anna", chat.chatId)).toEqual({
      values: { booking: { holdId: "h-1", start: "11:00" } },
      atMessageId: answer.id,
    });
  });

  it("ctx.state видит состояние ветки до ответа", async () => {
    const seen: unknown[] = [];
    const chat = await waitingSlot(
      async (_answer, ctx) => {
        seen.push(ctx.state.get());
        return undefined;
      },
      {
        agent: {
          tools: (model) => ({
            note: {
              description: "Записать",
              inputSchema: z.object({}),
              execute: async () => (model.state!.set("fields.email", "a@x.ru"), "ок"),
            },
          }),
        },
      },
      [step(widgetCall("n1", "note", {})), step(widgetCall("p1", "pick_slot", SLOT_INPUT))],
    );
    await answerAndFinish(chat.service, chat.chatId, "p1", slotAnswer);
    expect(seen).toEqual([{ fields: { email: "a@x.ru" } }]);
  });

  it("отказ после записи в ctx.state: состояние не меняется", async () => {
    const chat = await waitingSlot(async (_answer, ctx) => {
      ctx.state.set("booking.holdId", "h-1");
      return { refuse: "Занято" };
    });
    await expect(answerSlot(chat)).rejects.toBeInstanceOf(WidgetAnswerRefusedError);
    expect(stateParts(await lastAnswer(chat.service, chat.chatId))).toEqual([]);
    expect((await chat.service.getChatState("anna", chat.chatId)).values).toEqual({});
  });

  it("запись состояния после конца проверки не принимается", async () => {
    let leaked: (() => void) | undefined;
    const chat = await waitingSlot(async (_answer, ctx) => {
      leaked = () => ctx.state.set("late", true);
      return undefined;
    });
    await answerAndFinish(chat.service, chat.chatId, "p1", slotAnswer);
    leaked!();
    expect((await chat.service.getChatState("anna", chat.chatId)).values).toEqual({});
    expect(chat.logError).toHaveBeenCalledWith(expect.stringContaining("после конца"));
  });

  it("исключение проверки: исходное исключение наружу, ничего не записано, в журнале только имя ошибки", async () => {
    const chat = await waitingSlot(async () => {
      throw new Error("база недоступна");
    });
    const before = await lastAnswer(chat.service, chat.chatId);
    await expect(answerSlot(chat, { slot: "секрет-11:00" })).rejects.toThrow("база недоступна");
    expect(withoutFrozenContext((await chat.storage.getMessage(before.id))?.parts ?? [])).toEqual(before.parts);
    const lines = chat.logError.mock.calls.map(([line]) => line).filter((line) => line.startsWith("[виджет]"));
    expect(lines).toEqual([expect.stringContaining(`чат=${chat.chatId} вызов=p1`)]);
    expect(lines[0]).toContain("Error");
    expect(JSON.stringify(chat.logError.mock.calls)).not.toContain("база недоступна");
    expect(JSON.stringify(chat.logError.mock.calls)).not.toContain("секрет");
    await expect(answerSlot(chat)).rejects.toThrow("база недоступна");
  });
});

describe("срок проверки", () => {
  it("checkAnswerTimeoutMs: зависшая проверка — ошибка в срок, повтор идёт, опоздавшая запись состояния не попадает в ответ", async () => {
    let calls = 0;
    let lateWrite: (() => void) | undefined;
    const check: SlotCheck = async (_answer, ctx) => {
      if (calls++ > 0) return undefined;
      lateWrite = () => ctx.state.set("late", true);
      return new Promise<never>(() => {});
    };
    const chat = widgetChat([step(widgetCall("p1", "pick_slot", SLOT_INPUT))], { widgets: { custom: [pickSlotWith(check)], checkAnswerTimeoutMs: 20 } });
    const created = await chat.service.createChat("anna");
    await readAll(await chat.service.sendMessage("anna", created.id, userMessage("u1", "запишите меня")));
    const failed = await chat.service.answerWidget({ chatId: created.id, ownerId: "anna", toolCallId: "p1", answer: slotAnswer }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(WidgetAnswerCheckTimeoutError);
    expect((failed as Error).message).toMatch(/срок|20/);
    // Срок — отказ, не ошибка службы: в журнале строка об отказе, ошибки проверки нет.
    const lines = chat.logError.mock.calls.map(([line]) => line).filter((line) => line.startsWith("[виджет]"));
    expect(lines).toEqual([`[виджет] отказ answer_check_timeout чат=${created.id} вызов=p1`]);
    lateWrite!();
    await answerAndFinish(chat.service, created.id, "p1", slotAnswer);
    expect(stateParts(await lastAnswer(chat.service, created.id))).toEqual([]);
  });
});

describe("срок и отмена проверки (ctx.signal)", () => {
  it("срок по умолчанию — 5 с, меньше клиентского запроса (10 с)", () => {
    expect(createAgentWidgets({ basic: true }).checkTimeoutMs).toBe(5000);
  });

  it("срок вышел: ctx.signal сработал, ответ не записан, виджет открыт", async () => {
    let signal: AbortSignal | undefined;
    const check: SlotCheck = async (_answer, ctx) => {
      signal = ctx.signal;
      return new Promise<never>(() => {});
    };
    const chat = widgetChat([step(widgetCall("p1", "pick_slot", SLOT_INPUT))], { widgets: { custom: [pickSlotWith(check)], checkAnswerTimeoutMs: 20 } });
    const created = await chat.service.createChat("anna");
    await readAll(await chat.service.sendMessage("anna", created.id, userMessage("u1", "запишите меня")));
    const before = await lastAnswer(chat.service, created.id);
    await expect(chat.service.answerWidget({ chatId: created.id, ownerId: "anna", toolCallId: "p1", answer: slotAnswer })).rejects.toThrow(/срок/);
    expect(signal?.aborted).toBe(true);
    expect(withoutFrozenContext((await chat.storage.getMessage(before.id))?.parts ?? [])).toEqual(before.parts);
    expect((await chat.storage.getMessage(before.id))?.status).toBe("awaiting_approval");
  });

  it("исход проверки без отмены: ctx.signal не сработал", async () => {
    let signal: AbortSignal | undefined;
    const chat = await waitingSlot(async (_answer, ctx) => {
      signal = ctx.signal;
      return undefined;
    });
    await answerAndFinish(chat.service, chat.chatId, "p1", slotAnswer);
    expect(signal?.aborted).toBe(false);
  });

  it("«Стоп» во время проверки: signal сработал, ответ уходит без записи, виджет открыт, повтор принимается", async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const checkStarted = new Promise<void>((resolve) => (started = resolve));
    let release!: () => void;
    const hang = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const chat = await waitingSlot(async (_answer, ctx) => {
      if (calls++ > 0) return undefined;
      signal = ctx.signal;
      started();
      await hang; // приложение «Стоп» не слушает: ответ после него всё равно не пишется
      ctx.state.set("late", true);
      return { answer: { slot: "позже" } };
    });
    const before = await lastAnswer(chat.service, chat.chatId);
    const answering = answerSlot(chat).catch((error: unknown) => error);
    await checkStarted;
    expect(await chat.service.stop("anna", chat.chatId)).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(await answering).toBeInstanceOf(WidgetAnswerCheckAbortedError);
    // «Стоп» — штатное действие человека, не сбой: в журнале не ошибка проверки, а строка об отказе.
    const lines = chat.logError.mock.calls.map(([line]) => line);
    expect(lines.filter((line) => line.includes("ошибка проверки"))).toEqual([]);
    expect(lines).toContain(`[виджет] отказ answer_cancelled чат=${chat.chatId} вызов=p1`);
    release();
    await Promise.resolve();
    const stored = await chat.storage.getMessage(before.id);
    expect(stored?.status).toBe("awaiting_approval");
    expect(withoutFrozenContext(stored?.parts ?? [])).toEqual(before.parts);
    await answerAndFinish(chat.service, chat.chatId, "p1", slotAnswer);
    expect(toolPart(await lastAnswer(chat.service, chat.chatId), "p1")).toMatchObject({ output: slotAnswer });
  });

  it("«Стоп» после того, как проверка уже вернула исход, но до записи: ответ не пишется", async () => {
    let stopNow!: () => Promise<boolean>;
    const chat = await waitingSlot(async () => {
      await stopNow();
      return undefined;
    });
    stopNow = () => chat.service.stop("anna", chat.chatId);
    const before = await lastAnswer(chat.service, chat.chatId);
    await expect(answerSlot(chat)).rejects.toBeInstanceOf(WidgetAnswerCheckAbortedError);
    expect(withoutFrozenContext((await chat.storage.getMessage(before.id))?.parts ?? [])).toEqual(before.parts);
    expect((await chat.storage.getMessage(before.id))?.status).toBe("awaiting_approval");
  });

  it("«Стоп» без идущей проверки и хода: false, как раньше", async () => {
    const chat = await waitingSlot(async () => undefined);
    expect(await chat.service.stop("anna", chat.chatId)).toBe(false);
  });
});

describe("закрытие чата во время проверки", () => {
  it("closeChat внутри проверки: ChatClosedError, ответ и состояние не записаны, виджет закрыт, как при обычном закрытии, ход не идёт", async () => {
    const chat = await waitingSlot(async (_answer, ctx) => {
      ctx.state.set("booking.holdId", "h-1");
      await chat.service.closeChat({ ownerId: "anna", chatId: chat.chatId, code: "form_closed", message: "Запись закрыта" });
      return { answer: { slot: "подмена" } };
    });
    const calls = chat.model.doStreamCalls.length;
    await expect(answerSlot(chat)).rejects.toBeInstanceOf(ChatClosedError);
    // Закрытие из кода во время проверки ложится служебной записью в конец ветки, когда чат освободится.
    await vi.waitFor(async () => expect(JSON.stringify((await chat.storage.listMessages(chat.chatId)).at(-1)?.parts)).toContain("$closed"));
    const answer = (await chat.storage.listMessages(chat.chatId)).findLast((message) => toolPart(message, "p1"))!;
    expect(answer.status).toBe("complete");
    expect(toolPart(answer, "p1")).toMatchObject({ state: "output-error" });
    expect(JSON.stringify(answer.parts)).not.toContain("подмена");
    expect(stateParts(answer)).toEqual([]);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
  });
});

describe("порядок проверок", () => {
  it("ответ вне схемы — InvalidWidgetAnswerError, checkAnswer не зовётся", async () => {
    const check = vi.fn<SlotCheck>(async () => undefined);
    const chat = await waitingSlot(check);
    await expect(answerSlot(chat, { slot: 10 })).rejects.toBeInstanceOf(InvalidWidgetAnswerError);
    expect(check).not.toHaveBeenCalled();
  });

  it("нет такого вызова и чужой чат — checkAnswer не зовётся", async () => {
    const check = vi.fn<SlotCheck>(async () => undefined);
    const chat = await waitingSlot(check);
    await expect(answerSlot(chat, slotAnswer, "нет")).rejects.toBeInstanceOf(WidgetNotPendingError);
    await expect(chat.service.answerWidget({ chatId: chat.chatId, ownerId: "boris", toolCallId: "p1", answer: slotAnswer })).rejects.toBeInstanceOf(ChatNotFoundError);
    expect(check).not.toHaveBeenCalled();
  });

  it("beforeTurn отказал — checkAnswer не зовётся", async () => {
    const check = vi.fn<SlotCheck>(async () => undefined);
    const chat = await waitingSlot(check, { service: { beforeTurn: ({ action }) => (action === "widget" ? { code: "closed", message: "Закрыто" } : undefined) } });
    await expect(answerSlot(chat)).rejects.toBeInstanceOf(TurnRefusedError);
    expect(check).not.toHaveBeenCalled();
  });

  it("другая копия ответила, пока шла проверка: WidgetNotPendingError, состояние проверки не записано", async () => {
    let other: Promise<{ resumed: boolean }> | undefined;
    const chat = await waitingSlot(async (_answer, ctx) => {
      ctx.state.set("booking.holdId", "h-1");
      other = second.answerWidget({ chatId: chat.chatId, ownerId: "anna", toolCallId: "p1", answer: { slot: "10:00" } });
      await other;
      return undefined;
    });
    const second = chat.build(chat.storage, { widgets: { custom: [pickSlotWith()] } });
    await expect(answerSlot(chat)).rejects.toBeInstanceOf(WidgetNotPendingError);
    await readAll((await second.subscribe("anna", chat.chatId))!);
    const answer = await lastAnswer(chat.service, chat.chatId);
    expect(toolPart(answer, "p1")).toMatchObject({ output: { slot: "10:00" } });
    expect(stateParts(answer)).toEqual([]);
  });
});

describe("кэш модели", () => {
  it("запрос после ответа с записями состояния побайтно тот же, что без них", async () => {
    const withState = await waitingSlot(async (answer, ctx) => (ctx.state.set("booking.start", answer.slot), undefined));
    const plain = await waitingSlot(async () => undefined);
    await answerAndFinish(withState.service, withState.chatId, "p1", slotAnswer);
    await answerAndFinish(plain.service, plain.chatId, "p1", slotAnswer);
    expect(promptText(withState.model, 1)).toBe(promptText(plain.model, 1));
    expect(stateParts(await lastAnswer(withState.service, withState.chatId))).toHaveLength(1);
  });
});

describe("общая agent.widgets.checkAnswer", () => {
  it("для базового виджета: имя, вызов и вход, принятый ответ и тот же контекст; отказ и замена работают", async () => {
    const check = vi.fn(async (_call: unknown, answer: unknown, ctx: WidgetAnswerContext): Promise<WidgetAnswerVerdict> => {
      if ((answer as { выбрано: string }).выбрано === "Базовый") return { refuse: "Базовый тариф закрыт" };
      ctx.state.set("plan", "pro");
      return { answer: { ...(answer as object), проверено: true } };
    });
    const chat = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))], { widgets: { basic: true, checkAnswer: check } });
    const created = await chat.service.createChat("anna");
    await readAll(await chat.service.sendMessage("anna", created.id, userMessage("u1", "помоги выбрать")));
    await expect(chat.service.answerWidget({ chatId: created.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Базовый" } })).rejects.toThrow("Базовый тариф закрыт");
    await answerAndFinish(chat.service, created.id, "w1", { выбрано: "Про" });
    expect(check).toHaveBeenLastCalledWith(
      { toolName: "ask_choice", toolCallId: "w1", input: CHOICE_INPUT },
      { выбрано: "Про" },
      expect.objectContaining({ chatId: created.id, ownerId: "anna", toolName: "ask_choice", toolCallId: "w1", input: CHOICE_INPUT }),
    );
    const answer = await lastAnswer(chat.service, created.id);
    expect(toolPart(answer, "w1")).toMatchObject({ output: { выбрано: "Про", проверено: true } });
    expect((await chat.service.getChatState("anna", created.id)).values).toEqual({ plan: "pro" });
  });

  it("свой виджет без своей проверки тоже идёт через общую; со своей — общая не зовётся", async () => {
    const general = vi.fn(async () => undefined);
    const own = vi.fn<SlotCheck>(async () => undefined);
    const plainSlot = defineWidget({ name: "pick_day", description: "День", inputSchema: z.object({}), answerSchema: z.object({ day: z.string() }) });
    const chat = widgetChat([step(widgetCall("d1", "pick_day", {})), step(widgetCall("p1", "pick_slot", SLOT_INPUT))], {
      widgets: { custom: [plainSlot, pickSlotWith(own)], checkAnswer: general },
    });
    const created = await chat.service.createChat("anna");
    await readAll(await chat.service.sendMessage("anna", created.id, userMessage("u1", "запишите меня")));
    await answerAndFinish(chat.service, created.id, "d1", { day: "пн" });
    expect(general).toHaveBeenCalledTimes(1);
    await answerAndFinish(chat.service, created.id, "p1", slotAnswer);
    expect(own).toHaveBeenCalledTimes(1);
    expect(general).toHaveBeenCalledTimes(1);
  });
});
