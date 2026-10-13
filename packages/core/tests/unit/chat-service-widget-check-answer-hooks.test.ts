import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { UIMessageChunk } from "ai";
import { APP_STATE_PART_TYPE } from "../../src/app-state/app-state";
import type { StateChangedInput } from "../../src/app-state/state-changed";
import type { ChatEvent } from "../../src/chat-events/chat-events";
import { APP_EVENT_PART_TYPE } from "../../src/turn-hooks/app-events";
import { defineWidget } from "../../src/widgets/define-widget";
import { WidgetAnswerRefusedError } from "../../src/widgets/widget-answer-check";
import type { WidgetAnswerContext, WidgetAnswerVerdict } from "../../src/widgets/widget-types";
import { readAll } from "./support/mock-model";
import { tool } from "ai";
import { lastAnswer, removeTool, step, userMessage, widgetCall, widgetChat } from "./support/widget-chat";
import type { WidgetChatSetup } from "./support/widget-chat";

const SLOT_INPUT = { slots: ["10:00", "11:00"] };
const slotAnswer = { slot: "11:00" };

type SlotCheck = (answer: { slot: string }, ctx: WidgetAnswerContext<{ slots: string[] }>) => WidgetAnswerVerdict<{ slot: string }> | Promise<WidgetAnswerVerdict<{ slot: string }>>;

const pickSlotWith = (checkAnswer: SlotCheck) =>
  defineWidget({
    name: "pick_slot",
    description: "Выбрать время встречи",
    inputSchema: z.object({ slots: z.array(z.string()).min(2) }),
    answerSchema: z.object({ slot: z.string() }),
    checkAnswer,
  });

/** Чат с ждущим `pick_slot` (вызов `p1`), хуком смены состояния и подпиской на события чата. */
async function waitingSlot(checkAnswer: SlotCheck, setup: WidgetChatSetup = {}, scripts: Parameters<typeof widgetChat>[0] = [step(widgetCall("p1", "pick_slot", SLOT_INPUT))]) {
  const stateCalls: StateChangedInput[] = [];
  const chat = widgetChat(scripts, {
    widgets: { custom: [pickSlotWith(checkAnswer)] },
    ...setup,
    service: { onStateChanged: (input) => void stateCalls.push(input), ...setup.service },
  });
  const events: ChatEvent[] = [];
  chat.service.subscribeEvents((event) => events.push(event));
  const created = await chat.service.createChat("anna");
  await readAll(await chat.service.sendMessage("anna", created.id, userMessage("u1", "запишите меня")));
  return { ...chat, chatId: created.id, stateCalls, events };
}

/** Ответ на виджет и куски продолжения (нет продолжения — пусто). */
async function answerAndRead(chat: Awaited<ReturnType<typeof waitingSlot>>, answer: unknown = slotAnswer) {
  const result = await chat.service.answerWidget({ chatId: chat.chatId, ownerId: "anna", toolCallId: "p1", answer });
  const chunks: UIMessageChunk[] = result.resumed ? await readAll((await chat.service.subscribe("anna", chat.chatId))!) : [];
  await chat.service.flush();
  return { result, chunks };
}

describe("onStateChanged после checkAnswer", () => {
  it("записи ctx.state зовут хук с причиной widgetAnswer: до и после, atMessageId — ответ с виджетом", async () => {
    const chat = await waitingSlot(async (answer, ctx) => {
      ctx.state.set("booking.start", answer.slot);
      return undefined;
    });
    const waiting = await lastAnswer(chat.service, chat.chatId);
    await answerAndRead(chat);
    expect(chat.stateCalls).toEqual([
      { ownerId: "anna", chatId: chat.chatId, reason: "widgetAnswer", state: { booking: { start: "11:00" } }, previousState: {}, atMessageId: waiting.id },
    ]);
    expect(chat.events).toContainEqual(expect.objectContaining({ type: "state-changed", reason: "widgetAnswer", state: { booking: { start: "11:00" } } }));
  });

  it("проверка ничего не записала — хука нет; отказ после записи — хука нет", async () => {
    const quiet = await waitingSlot(async () => undefined);
    await answerAndRead(quiet);
    expect(quiet.stateCalls).toEqual([]);

    const refused = await waitingSlot(async (_answer, ctx) => {
      ctx.state.set("booking.start", "11:00");
      return { refuse: "Занято" };
    });
    await expect(refused.service.answerWidget({ chatId: refused.chatId, ownerId: "anna", toolCallId: "p1", answer: slotAnswer })).rejects.toBeInstanceOf(WidgetAnswerRefusedError);
    await refused.service.flush();
    expect(refused.stateCalls).toEqual([]);
  });

  it("ответ ещё ждёт другого решения (resumed: false) — хук всё равно зовётся", async () => {
    const chat = await waitingSlot(
      async (_answer, ctx) => {
        ctx.state.set("booking.start", "11:00");
        return undefined;
      },
      { agent: { tools: { remove: removeTool() } } },
      [step(widgetCall("p1", "pick_slot", SLOT_INPUT), widgetCall("r1", "remove", { path: "a.txt" }))],
    );
    const { result } = await answerAndRead(chat);
    expect(result.resumed).toBe(false);
    expect(chat.stateCalls.map((call) => call.reason)).toEqual(["widgetAnswer"]);
  });

  it("ход после ответа состояние не меняет — хук один, widgetAnswer, без повтора от хода", async () => {
    const chat = await waitingSlot(async (_answer, ctx) => {
      ctx.state.set("booking.start", "11:00");
      return undefined;
    });
    // Ход после ответа сам состояние не пишет: хук хода не зовётся, повторного widgetAnswer нет.
    await answerAndRead(chat);
    expect(chat.stateCalls.map((call) => call.reason)).toEqual(["widgetAnswer"]);
  });
});

describe("ctx.emitAppEvent в checkAnswer", () => {
  it("событие ложится в ответ после результата вызова и записей состояния; в продолжении — сразу после start, до слов модели", async () => {
    const chat = await waitingSlot(async (answer, ctx) => {
      ctx.state.set("booking.start", answer.slot);
      ctx.emitAppEvent!({ type: "slot_booked", data: { slot: answer.slot } });
      return undefined;
    });
    const { chunks } = await answerAndRead(chat);
    const answer = await lastAnswer(chat.service, chat.chatId);
    const index = (match: (part: { type: string; toolCallId?: string }) => boolean) => answer.parts.findIndex((part) => match(part as never));
    const eventAt = index((part) => part.type === APP_EVENT_PART_TYPE);
    expect(answer.parts[eventAt]).toEqual({ type: APP_EVENT_PART_TYPE, data: { type: "slot_booked", data: { slot: "11:00" } } });
    expect(eventAt).toBeGreaterThan(index((part) => part.toolCallId === "p1"));
    expect(eventAt).toBeGreaterThan(index((part) => part.type === APP_STATE_PART_TYPE));

    const types = chunks.map((chunk) => chunk.type);
    const eventChunk = types.indexOf(APP_EVENT_PART_TYPE as never);
    expect(eventChunk).toBeGreaterThan(types.indexOf("start"));
    expect(eventChunk).toBeLessThan(types.indexOf("text-delta"));
    expect(chunks[eventChunk]).toMatchObject({ data: { type: "slot_booked" } });
    expect(chunks.filter((chunk) => chunk.type === APP_EVENT_PART_TYPE)).toHaveLength(1);
  });

  it("событие модели не уходит: запрос продолжения тот же, что без него", async () => {
    const quiet = await waitingSlot(async () => undefined);
    await answerAndRead(quiet);
    const loud = await waitingSlot(async (_answer, ctx) => {
      ctx.emitAppEvent!({ type: "slot_booked" });
      return undefined;
    });
    await answerAndRead(loud);
    expect(JSON.stringify(loud.model.doStreamCalls[1]!.prompt).replaceAll(loud.chatId, "")).toBe(JSON.stringify(quiet.model.doStreamCalls[1]!.prompt).replaceAll(quiet.chatId, ""));
  });

  it("отказ после события — события нет ни в ответе, ни в потоке", async () => {
    const chat = await waitingSlot(async (_answer, ctx) => {
      ctx.emitAppEvent!({ type: "slot_booked" });
      return { refuse: "Занято" };
    });
    await expect(chat.service.answerWidget({ chatId: chat.chatId, ownerId: "anna", toolCallId: "p1", answer: slotAnswer })).rejects.toBeInstanceOf(WidgetAnswerRefusedError);
    expect((await lastAnswer(chat.service, chat.chatId)).parts.some((part) => part.type === APP_EVENT_PART_TYPE)).toBe(false);
    expect(chat.events.some((event) => event.type === "app-event")).toBe(false);
  });

  it("неверное событие — TypeError сразу в проверке; событие после конца проверки — строка в журнал, не пишется", async () => {
    let thrown: unknown;
    let late: (() => void) | undefined;
    const chat = await waitingSlot(async (_answer, ctx) => {
      try {
        ctx.emitAppEvent!({ type: "" });
      } catch (error) {
        thrown = error;
      }
      late = () => ctx.emitAppEvent!({ type: "late" });
      return undefined;
    });
    await answerAndRead(chat);
    expect(thrown).toBeInstanceOf(TypeError);
    late!();
    expect((await lastAnswer(chat.service, chat.chatId)).parts.some((part) => part.type === APP_EVENT_PART_TYPE)).toBe(false);
    expect(chat.logError).toHaveBeenCalledWith(expect.stringContaining("«late»"));
  });

  it("без продолжения (resumed: false) — событие в ответе и в канале наблюдения с messageId ответа", async () => {
    const chat = await waitingSlot(
      async (_answer, ctx) => {
        ctx.emitAppEvent!({ type: "slot_booked" });
        return undefined;
      },
      { agent: { tools: { remove: removeTool() } } },
      [step(widgetCall("p1", "pick_slot", SLOT_INPUT), widgetCall("r1", "remove", { path: "a.txt" }))],
    );
    const waiting = await lastAnswer(chat.service, chat.chatId);
    const { result } = await answerAndRead(chat);
    expect(result.resumed).toBe(false);
    expect((await lastAnswer(chat.service, chat.chatId)).parts).toContainEqual({ type: APP_EVENT_PART_TYPE, data: { type: "slot_booked" } });
    expect(chat.events).toContainEqual({ type: "app-event", ownerId: "anna", chatId: chat.chatId, messageId: waiting.id, event: { type: "slot_booked" } });
  });

  it("с продолжением событие идёт потоком, а не в канал наблюдения (иначе вкладка получила бы его дважды)", async () => {
    const chat = await waitingSlot(async (_answer, ctx) => {
      ctx.emitAppEvent!({ type: "slot_booked" });
      return undefined;
    });
    await answerAndRead(chat);
    expect(chat.events.some((event) => event.type === "app-event")).toBe(false);
  });

  it("общая проверка agent.widgets.checkAnswer тоже может слать события", async () => {
    const general = vi.fn(async (_call: unknown, _answer: unknown, ctx: WidgetAnswerContext) => {
      ctx.emitAppEvent!({ type: "answered" });
      return undefined;
    });
    const chat = widgetChat([step(widgetCall("c1", "ask_choice", { question: "Какой тариф?", options: ["Базовый", "Про"] }))], { widgets: { basic: true, checkAnswer: general } });
    const created = await chat.service.createChat("anna");
    await readAll(await chat.service.sendMessage("anna", created.id, userMessage("u1", "помоги")));
    await chat.service.answerWidget({ chatId: created.id, ownerId: "anna", toolCallId: "c1", answer: { выбрано: "Про" } });
    await readAll((await chat.service.subscribe("anna", created.id))!);
    expect((await lastAnswer(chat.service, created.id)).parts).toContainEqual({ type: APP_EVENT_PART_TYPE, data: { type: "answered" } });
  });

  it("ответ виджета с событием → сбой продолжения → «Повторить»: копия события помечена скопированной, живым её не считают", async () => {
    const find = tool({ description: "Найти", inputSchema: z.object({ q: z.string() }), execute: async () => "нашёл" });
    const chat = await waitingSlot(
      async (_answer, ctx) => {
        ctx.emitAppEvent!({ type: "slot_booked" });
        return undefined;
      },
      { agent: { tools: { find } } },
      [step(widgetCall("p1", "pick_slot", SLOT_INPUT)), step(widgetCall("f1", "find", { q: "x" })), new Error("сбой модели")],
    );
    const { chunks } = await answerAndRead(chat);
    const fresh = chunks.filter((chunk) => chunk.type === APP_EVENT_PART_TYPE);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).not.toHaveProperty("id");
    const failed = await lastAnswer(chat.service, chat.chatId);

    const retried = await readAll(await chat.service.retry("anna", chat.chatId));
    const copies = retried.filter((chunk) => chunk.type === APP_EVENT_PART_TYPE) as Array<{ id?: string; data: unknown }>;
    expect(copies).toHaveLength(1);
    expect(copies[0]!.id).toMatch(new RegExp(`^copied:${failed.id}:`));
    const answer = await lastAnswer(chat.service, chat.chatId);
    expect(answer.id).not.toBe(failed.id);
    expect(answer.parts.find((part) => part.type === APP_EVENT_PART_TYPE)).toEqual({ type: APP_EVENT_PART_TYPE, id: copies[0]!.id, data: { type: "slot_booked" } });
  });

  it("сумма событий одной проверки больше 16 КБ — понятная ошибка разработчику сразу в проверке", async () => {
    let thrown: unknown;
    const chat = await waitingSlot(async (_answer, ctx) => {
      ctx.emitAppEvent!({ type: "big", data: "я".repeat(5000) });
      try {
        ctx.emitAppEvent!({ type: "big", data: "я".repeat(5000) });
      } catch (error) {
        thrown = error;
      }
      return undefined;
    });
    await answerAndRead(chat);
    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toMatch(/16 КБ/);
    const events = (await lastAnswer(chat.service, chat.chatId)).parts.filter((part) => part.type === APP_EVENT_PART_TYPE);
    expect(events).toHaveLength(1);
  });
});
