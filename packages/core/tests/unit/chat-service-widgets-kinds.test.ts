import { describe, expect, it } from "vitest";
import { InvalidWidgetAnswerError } from "../../src/chat-service";
import { SUGGESTIONS_SHOWN } from "../../src/widgets/basic-widgets";
import { answerAndFinish, ask, lastAnswer, promptText, step, toolPart, widgetCall, widgetChat } from "./support/widget-chat";

/** Путь «вызов → ожидание → ответ → продолжение» для каждого ждущего базового виджета. */
const cases = [
  {
    name: "ask_multi_choice",
    input: { question: "Что подключить?", options: ["Почта", "Чат", "Звонки"], min: 1, max: 2 },
    sent: { выбрано: ["Звонки", "Почта"] },
    // Выбор нескольких — в порядке вариантов, а не кликов.
    stored: { выбрано: ["Почта", "Звонки"] },
    bad: { выбрано: ["Почта", "Чат", "Звонки"] },
  },
  {
    name: "ask_rating",
    input: { question: "Насколько удобно?", scale: "range", from: 0, to: 10, fromLabel: "никак", toLabel: "очень" },
    sent: { оценка: 7 },
    stored: { оценка: 7 },
    bad: { оценка: 11 },
  },
  {
    name: "ask_form",
    input: {
      title: "Данные для счёта",
      fields: [
        { name: "company", label: "Компания", kind: "text", required: true },
        { name: "seats", label: "Мест", kind: "number", min: 1, max: 100 },
        { name: "plan", label: "Тариф", kind: "select", options: ["Базовый", "Про"], required: true },
        { name: "start", label: "С какого дня", kind: "date" },
      ],
    },
    sent: { поля: { company: "Ромашка", seats: 5, plan: "Про", start: "" } },
    // Пустое необязательное поле опущено.
    stored: { поля: { company: "Ромашка", seats: 5, plan: "Про" } },
    bad: { поля: { seats: 5, plan: "Про" } },
  },
] as const;

describe.each(cases)("$name: вызов → ожидание → ответ → продолжение", ({ name, input, sent, stored, bad }) => {
  it("ход ждёт, ответ записан коротким JSON, модель продолжает с ним", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", name, input))]);
    const { chat } = await ask(service);
    const waiting = await lastAnswer(service, chat.id);
    expect(waiting.metadata?.status).toBe("awaiting_approval");
    expect(toolPart(waiting, "w1")).toMatchObject({ type: `tool-${name}`, state: "input-available", input });

    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: bad })).rejects.toBeInstanceOf(InvalidWidgetAnswerError);
    expect(await answerAndFinish(service, chat.id, "w1", sent)).toEqual({ resumed: true });

    const answer = await lastAnswer(service, chat.id);
    expect(answer.id).toBe(waiting.id);
    expect(answer.metadata?.status).toBe("complete");
    expect(toolPart(answer, "w1")).toMatchObject({ state: "output-available", output: stored });
    expect(promptText(model, 1)).toContain(JSON.stringify({ type: "json", value: stored }));
  });
});

describe("suggest_replies: несколько вызовов за ход не ломают ход", () => {
  it("каждый вызов получает «показано», ход не ждёт и кончается законченным ответом", async () => {
    const suggest = (id: string, replies: string[]) => widgetCall(id, "suggest_replies", { replies });
    const { service } = widgetChat([step(suggest("s1", ["Да", "Нет"]), suggest("s2", ["Позже"])), step(suggest("s3", ["Ещё"]))]);
    const { chat } = await ask(service);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("complete");
    for (const id of ["s1", "s2", "s3"]) expect(toolPart(answer, id)).toMatchObject({ state: "output-available", output: SUGGESTIONS_SHOWN });
  });
});

it("всё нужное приложению и серверу видно из корня пакета", async () => {
  const core = await import("../../src/index");
  expect(typeof core.defineWidget).toBe("function");
  expect(core.WidgetNotPendingError).toBeDefined();
  expect(core.InvalidWidgetAnswerError).toBeDefined();
  expect(core.ANSWERED_BY_MESSAGE).toEqual({ ответ: "сообщением" });
  expect(core.WIDGET_ANSWER_MAX_BYTES).toBe(16 * 1024);
  expect(core.BASIC_WIDGET_NAMES).toContain("ask_choice");
});
