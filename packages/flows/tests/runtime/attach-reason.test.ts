import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool } from "../../../core/tests/unit/support/notice-chat";
import { describeCondition } from "../../src/runtime/flow-events";
import { nextTransition } from "../../src/engine/next-transition";
import { startRun } from "../../src/engine/run-updates";
import type { FlowTransitionEvent } from "../../src/runtime/flow-types";
import { fixtureFlow, HOUR } from "../flow-fixtures";
import { flowChat, newChat, OWNER, say } from "./flow-chat";
import { clockAt, human, MSK, T0, tick, timerChat } from "./timer-chat";

// T104: причина перехода словами — у заявки (`why` агента), судьи (условие), таймера, данных и события. Идёт в
// `onTransition` и в путь разговора.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const NOW = T0;

describe("движок: причина перехода по виду решения", () => {
  const flow = fixtureFlow("sales-review", (json) => {
    json.clientCard.push({ id: "paid", name: "Оплатил", type: "boolean", about: "Оплатил ли разбор." });
    json.states.find((state: { id: string }) => state.id === "intro").exits.push({ id: "intro_paid", when: { type: "data", field: "paid", op: "eq", value: true }, to: "booked" });
  });
  const run = startRun(flow, NOW);

  it("заявка агента — его «почему»", () => {
    const transition = nextTransition(flow, run, { type: "verdict", exitId: "intro_clear", probability: 0.9, decidedBy: "claim", why: "человек всё рассказал" }, NOW);
    expect(transition).toMatchObject({ decidedBy: "claim", reason: { kind: "claim", text: "человек всё рассказал" } });
  });

  it("заявка без «почему» — условие словами", () => {
    const transition = nextTransition(flow, run, { type: "verdict", exitId: "intro_clear", probability: 0.9, decidedBy: "claim", why: "  " }, NOW);
    expect(transition?.reason).toEqual({ kind: "claim", text: "Понятны тема курса и продажи" });
  });

  it("судья — условие, которое он подтвердил", () => {
    const transition = nextTransition(flow, run, { type: "verdict", exitId: "intro_clear", probability: 0.8, decidedBy: "judge" }, NOW);
    expect(transition).toMatchObject({ decidedBy: "judge", probability: 0.8, reason: { kind: "judge", text: "Понятны тема курса и продажи" } });
  });

  it("таймер — «тишина 3 ч»", () => {
    const silent = { ...run, lastAgentAt: NOW - 3 * HOUR, lastHumanAt: NOW - 4 * HOUR };
    const transition = nextTransition(flow, silent, { type: "timer", exitId: "any_silence", timeZone: MSK }, NOW);
    expect(transition?.reason).toEqual({ kind: "timer", text: "тишина 3 ч" });
  });

  it("данные — «поле = да»", () => {
    const transition = nextTransition(flow, run, { type: "data", field: "paid", card: { paid: true } }, NOW);
    expect(transition).toMatchObject({ decidedBy: "data", reason: { kind: "data", text: "«Оплатил» = да" } });
  });

  it("событие — его имя", () => {
    const offer = { ...run, state: "offer" };
    const transition = nextTransition(flow, offer, { type: "event", event: "button", name: "booking_link" }, NOW);
    expect(transition?.reason).toEqual({ kind: "event", text: "нажата кнопка «booking_link»" });
    const message = nextTransition(flow, { ...run, state: "remind" }, { type: "event", event: "message" }, NOW);
    expect(message?.reason).toEqual({ kind: "event", text: "человек написал" });
  });
});

describe("описание условий для причины", () => {
  const flow = fixtureFlow("sales-review");

  it("время ноды в днях и часах", () => {
    expect(describeCondition(flow, { type: "timer", from: "state_days", days: 1 })).toBe("нода длится 1 день");
    expect(describeCondition(flow, { type: "timer", from: "state_days", days: 3 })).toBe("нода длится 3 дня");
    expect(describeCondition(flow, { type: "timer", from: "state_days", days: 5 })).toBe("нода длится 5 дней");
    expect(describeCondition(flow, { type: "timer", from: "in_state", amount: 20, unit: "min" })).toBe("в состоянии 20 мин");
  });

  it("данные: знаки вместо кодов операций, «да/нет» вместо true/false", () => {
    expect(describeCondition(flow, { type: "data", field: "booked", op: "eq", value: "да" })).toBe("«Записался» = да");
    expect(describeCondition(flow, { type: "data", field: "booked", op: "ne", value: "да" })).toBe("«Записался» ≠ да");
    expect(describeCondition(flow, { type: "data", field: "booked", op: "filled" })).toBe("узнали «Записался»");
  });
});

describe("в onTransition и в пути разговора", () => {
  const claim = (exit: number) => callTool("flow_exit", "x1", { exit, why: "человек всё рассказал" });

  it("заявка агента: kind «claim» и его слова", async () => {
    const events: FlowTransitionEvent[] = [];
    const chat = flowChat({ yes: ["intro_clear"], scripts: [claim(1)], onTransition: (event) => void events.push(event) });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "курс про Excel, продаж нет");
    await chat.flow.settled();

    expect(events).toMatchObject([{ chatId: id, from: "intro", to: "block", decidedBy: "claim", reason: { kind: "claim", text: "человек всё рассказал" } }]);
    const { values } = await chat.service.getChatState(OWNER, id);
    expect((values.flow as { path: Array<{ reason?: unknown }> }).path.at(-1)?.reason).toEqual({ kind: "claim", text: "человек всё рассказал" });
  });

  it("судья после хода: kind «judge» и условие", async () => {
    const events: FlowTransitionEvent[] = [];
    const chat = flowChat({ yes: ["intro_clear"], onTransition: (event) => void events.push(event) });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "курс про Excel, продаж нет");
    await chat.flow.settled();
    chat.yes.clear();
    await say(chat.service, id, "да");
    await chat.flow.settled();

    expect(events).toMatchObject([{ decidedBy: "judge", reason: { kind: "judge", text: "Понятны тема курса и продажи" } }]);
  });

  it("таймер и сообщение человека: «тишина 3 ч», «человек написал»", async () => {
    const chat = timerChat();
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "привет");
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    clockAt(T0 + 4 * HOUR);
    await human(chat, id, "я вернулся");

    const { values } = await chat.service.getChatState(OWNER, id);
    const path = (values.flow as { path: Array<{ state: string; decidedBy: string; reason?: unknown }> }).path;
    expect(path.slice(-2)).toMatchObject([
      { state: "remind", decidedBy: "timer", reason: { kind: "timer", text: "тишина 3 ч" } },
      { state: "intro", decidedBy: "event", reason: { kind: "event", text: "человек написал" } },
    ]);
  });
});
