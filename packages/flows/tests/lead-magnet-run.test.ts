import { describe, expect, it } from "vitest";
import {
  applyTransition,
  nextDue,
  nextTransition,
  noteAgentAnswer,
  noteHumanMessage,
  startRun,
  type FlowEvent,
  type FlowRun,
} from "../src/format";
import { DAY, HOUR, MIN, fixtureFlow } from "./flow-fixtures";

// SC-001 без модели: «Разбор продаж» от старта до «Записался» и до «Прощания по тишине» на чистых функциях и
// подменённых часах. Судья подменён вердиктами, таймеры срабатывают ровно в срок из `nextDue`.

const TZ = "Europe/Moscow";
const T0 = Date.UTC(2026, 9, 13, 6, 0); // 09:00 по Москве
const flow = fixtureFlow("sales-review");

class Chat {
  run: FlowRun;
  now = T0;
  constructor() {
    this.run = startRun(flow, T0);
    this.agentAnswers();
  }
  wait(ms: number) {
    this.now += ms;
  }
  human() {
    this.run = noteHumanMessage(this.run, this.now);
    this.apply({ type: "event", event: "message" });
  }
  agentAnswers() {
    this.run = noteAgentAnswer(this.run, this.now);
  }
  apply(event: FlowEvent) {
    const transition = nextTransition(flow, this.run, event, this.now);
    if (transition) this.run = applyTransition(flow, this.run, transition);
    return transition;
  }
  /** Ждёт ближайший таймер и срабатывает им: агент пишет первым. */
  fireNextTimer() {
    const due = nextDue(flow, this.run, this.now, TZ);
    if (!due) throw new Error(`в «${this.run.state}» таймеров нет`);
    this.now = Math.max(this.now, due.at);
    this.apply({ type: "timer", exitId: due.exitId, timeZone: TZ });
    this.agentAnswers();
  }
  get states() {
    return this.run.path.map((step) => step.state);
  }
}

describe("лидмагнит «Разбор продаж» на подменённых часах", () => {
  it("от знакомства до «Записался»; вопрос о цене состояние не меняет", () => {
    const chat = new Chat();
    chat.wait(MIN);
    chat.human(); // «Курс по акварели, продал 5 штук»
    expect(chat.apply({ type: "verdict", exitId: "intro_clear", probability: 0.98, decidedBy: "claim" })?.to).toBe("block");
    chat.agentAnswers();
    chat.wait(2 * MIN);
    chat.human(); // «А сколько стоит?» — агент отвечает из «Общего», судья ничего не нашёл
    chat.agentAnswers();
    expect(chat.run.state).toBe("block");
    chat.wait(2 * MIN);
    chat.human();
    chat.apply({ type: "verdict", exitId: "block_found", probability: 0.9, decidedBy: "judge" });
    chat.agentAnswers();
    chat.wait(MIN);
    const booked = chat.apply({ type: "event", event: "button", name: "booking_link" });
    expect(booked).toMatchObject({ from: "offer", to: "booked", tags: ["успех"] });
    expect(chat.states).toEqual(["intro", "block", "offer", "booked"]);
    expect(nextDue(flow, chat.run, chat.now, TZ)).toBeNull();
  });

  it("тишина: напоминание → утреннее касание → прощание через 3 дня с начала", () => {
    const chat = new Chat();
    chat.wait(MIN);
    chat.human();
    chat.apply({ type: "verdict", exitId: "intro_clear", probability: 0.95, decidedBy: "judge" });
    chat.agentAnswers();
    const lastAnswer = chat.now;

    chat.fireNextTimer();
    expect(chat.run.state).toBe("remind");
    expect(chat.now).toBe(lastAnswer + 3 * HOUR);

    chat.fireNextTimer(); // в «Напоминании» общая тишина ведёт в него же — ждём утра
    expect(chat.run.state).toBe("morning");
    expect(chat.now).toBe(Date.UTC(2026, 9, 14, 7, 0)); // 10:00 по Москве

    chat.fireNextTimer();
    expect(chat.run.state).toBe("bye");
    expect(chat.now).toBe(T0 + 3 * DAY);
    expect(chat.states).toEqual(["intro", "block", "remind", "morning", "bye"]);
    expect(chat.run.path.slice(2).map((step) => step.decidedBy)).toEqual(["timer", "timer", "timer"]);
  });

  it("человек ответил утром — агент возвращается к поиску затыка", () => {
    const chat = new Chat();
    chat.human();
    chat.apply({ type: "verdict", exitId: "intro_clear", probability: 0.95, decidedBy: "judge" });
    chat.agentAnswers();
    chat.fireNextTimer();
    chat.fireNextTimer();
    chat.wait(30 * MIN);
    chat.human();
    expect(chat.run.state).toBe("block");
    expect(chat.run.path.at(-1)).toMatchObject({ from: "morning", exitId: "morning_message", decidedBy: "event" });
  });
});
