import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { describe, expect, it, vi } from "vitest";
import { russianLabels } from "../../src/labels";
import { formCheckMessages } from "../../src/widgets/form-check";
import { widgetCallOf, widgetViewOf } from "../../src/widgets/widget-view";
import type { WidgetCall } from "../../src/widgets/widget-view";

type Part = ToolUIPart | DynamicToolUIPart;
const part = (fields: Record<string, unknown>) => ({ toolCallId: "call-1", ...fields }) as unknown as Part;
const here = { awaitingHere: true, customNames: new Set<string>() };
const elsewhere = { awaitingHere: false, customNames: new Set<string>() };
const choiceInput = { question: "Какой тариф?", options: ["Старт", "Про"] };
const messages = formCheckMessages(russianLabels.widgets);

describe("widgetCallOf: часть вызова → виджет", () => {
  it("ждущий вызов в последнем ответе ветки, который ждёт, — активен", () => {
    expect(widgetCallOf(part({ type: "tool-ask_choice", state: "input-available", input: choiceInput }), here)).toEqual({
      toolCallId: "call-1",
      name: "ask_choice",
      input: choiceInput,
      state: "pending",
    });
  });

  it("тот же вызов не в последнем ответе или ответ не ждёт — неактивен (closed)", () => {
    expect(widgetCallOf(part({ type: "tool-ask_choice", state: "input-available", input: choiceInput }), elsewhere)).toMatchObject({ state: "closed" });
  });

  it("отвечен: выбор из результата вызова", () => {
    const call = widgetCallOf(part({ type: "tool-ask_choice", state: "output-available", input: choiceInput, output: { "выбрано": "Про" } }), here);
    expect(call).toMatchObject({ state: "answered", answer: { "выбрано": "Про" } });
  });

  it("{\"ответ\":\"сообщением\"} — закрыт сообщением", () => {
    const call = widgetCallOf(part({ type: "tool-ask_choice", state: "output-available", input: choiceInput, output: { "ответ": "сообщением" } }), here);
    expect(call).toMatchObject({ state: "answered_by_message" });
    expect((call as WidgetCall).answer).toBeUndefined();
  });

  it("закрыт «Стопом» или сбоем (ошибка с годным входом) — неактивен", () => {
    const call = widgetCallOf(part({ type: "tool-ask_choice", state: "output-error", input: choiceInput, errorText: "Вызов инструмента оборвался" }), here);
    expect(call).toMatchObject({ state: "closed" });
  });

  it("негодный вход и «один вопрос за раз» — виджет не показан", () => {
    expect(widgetCallOf(part({ type: "tool-ask_choice", state: "output-error", input: { question: "" }, errorText: "схема" }), here)).toBe("hidden");
    expect(
      widgetCallOf(part({ type: "tool-ask_choice", state: "output-error", input: choiceInput, errorText: "Задавай один вопрос за раз" }), here),
    ).toBe("hidden");
  });

  it("модель ещё пишет вход — виджета пока нет", () => {
    expect(widgetCallOf(part({ type: "tool-ask_choice", state: "input-streaming", input: { question: "Как" } }), here)).toBe("hidden");
  });

  it("ответ ушёл, ход продолжается (вызов «в пути» с результатом) — отвечен", () => {
    const call = widgetCallOf(part({ type: "tool-ask_choice", state: "input-streaming", input: choiceInput, output: { "выбрано": "Старт" } }), here);
    expect(call).toMatchObject({ state: "answered", answer: { "выбрано": "Старт" } });
  });

  it("обычный инструмент — не виджет; подсказки — не виджет в ленте", () => {
    expect(widgetCallOf(part({ type: "tool-read_notes", state: "output-available", input: {}, output: "ок" }), here)).toBeNull();
    expect(widgetCallOf(part({ type: "tool-suggest_replies", state: "output-available", input: { replies: ["Да"] }, output: "показано" }), here)).toBeNull();
  });

  it("свой виджет по имени со страницы; неизвестный ждущий вызов без подтверждения — свой без компонента", () => {
    const custom = { awaitingHere: true, customNames: new Set(["pick_slot"]) };
    expect(widgetCallOf(part({ type: "tool-pick_slot", state: "output-available", input: { slots: ["10:00"] }, output: { slot: "10:00" } }), custom)).toMatchObject({
      name: "pick_slot",
      state: "answered",
      answer: { slot: "10:00" },
    });
    expect(widgetCallOf(part({ type: "tool-mystery", state: "input-available", input: {} }), here)).toMatchObject({ name: "mystery", state: "pending" });
    expect(widgetCallOf(part({ type: "tool-mystery", state: "input-available", input: {} }), elsewhere)).toBeNull();
    expect(
      widgetCallOf(part({ type: "tool-delete", state: "approval-requested", input: {}, approval: { id: "ap1" } }), here),
    ).toBeNull();
    expect(widgetCallOf(part({ type: "tool-mystery", state: "output-available", input: {}, output: { "ответ": "сообщением" } }), here)).toMatchObject({
      state: "answered_by_message",
    });
  });
});

describe("widgetViewOf: виджет → вид для скина", () => {
  const call = (fields: Partial<WidgetCall>): WidgetCall => ({ toolCallId: "call-1", name: "ask_choice", input: choiceInput, state: "pending", ...fields });

  it("вопрос с вариантами: одно нажатие отвечает {\"выбрано\"}", () => {
    const onAnswer = vi.fn();
    const view = widgetViewOf(call({}), { pending: false, onAnswer, messages });
    expect(view).toMatchObject({ kind: "choice", toolCallId: "call-1", active: true, pending: false, answeredByMessage: false, question: "Какой тариф?", options: ["Старт", "Про"] });
    (view as Extract<typeof view, { kind: "choice" }>).onChoose!("Про");
    expect(onAnswer).toHaveBeenCalledWith({ "выбрано": "Про" });
  });

  it("отвечен: выбранный показан, нажимать нечего", () => {
    const view = widgetViewOf(call({ state: "answered", answer: { "выбрано": "Про" } }), { pending: false, messages });
    expect(view).toMatchObject({ kind: "choice", active: false, chosen: "Про" });
    expect((view as { onChoose?: unknown }).onChoose).toBeUndefined();
  });

  it("закрыт сообщением: пометка, без выбора", () => {
    expect(widgetViewOf(call({ state: "answered_by_message" }), { pending: false, messages })).toMatchObject({ active: false, answeredByMessage: true });
  });

  it("пока ответ уходит — pending и текст сбоя передаются", () => {
    expect(widgetViewOf(call({}), { pending: true, failure: "нет связи", onAnswer: vi.fn(), messages })).toMatchObject({ pending: true, failure: "нет связи" });
  });

  it("несколько вариантов: пределы по умолчанию 1..n, выбор уходит в порядке вариантов, вне пределов не уходит", () => {
    const onAnswer = vi.fn();
    const input = { question: "Что добавить?", options: ["А", "Б", "В"] };
    const view = widgetViewOf(call({ name: "ask_multi_choice", input }), { pending: false, onAnswer, messages }) as Extract<
      ReturnType<typeof widgetViewOf>,
      { kind: "multi_choice" }
    >;
    expect(view).toMatchObject({ kind: "multi_choice", min: 1, max: 3 });
    view.onSubmit!(["В", "А"]);
    expect(onAnswer).toHaveBeenCalledWith({ "выбрано": ["А", "В"] });
    onAnswer.mockClear();
    view.onSubmit!([]);
    view.onSubmit!(["Г"]);
    expect(onAnswer).not.toHaveBeenCalled();
    const bounded = widgetViewOf(call({ name: "ask_multi_choice", input: { ...input, min: 2, max: 2 } }), { pending: false, messages });
    expect(bounded).toMatchObject({ min: 2, max: 2 });
    expect(widgetViewOf(call({ name: "ask_multi_choice", input, state: "answered", answer: { "выбрано": ["Б"] } }), { pending: false, messages })).toMatchObject({
      chosen: ["Б"],
    });
  });

  it("оценка: звёзды 1..5 и шкала с подписями; ответ {\"оценка\"}", () => {
    const onAnswer = vi.fn();
    const stars = widgetViewOf(call({ name: "ask_rating", input: { question: "Как вам?", scale: "stars" } }), { pending: false, onAnswer, messages });
    expect(stars).toMatchObject({ kind: "rating", scale: "stars", from: 1, to: 5 });
    (stars as Extract<typeof stars, { kind: "rating" }>).onRate!(4);
    expect(onAnswer).toHaveBeenCalledWith({ "оценка": 4 });
    const range = widgetViewOf(
      call({ name: "ask_rating", input: { question: "Насколько вероятно?", scale: "range", from: 0, to: 10, fromLabel: "никак", toLabel: "точно" }, state: "answered", answer: { "оценка": 9 } }),
      { pending: false, messages },
    );
    expect(range).toMatchObject({ scale: "range", from: 0, to: 10, fromLabel: "никак", toLabel: "точно", value: 9, active: false });
  });

  it("форма: поля для скина, ошибки полей, верное уходит {\"поля\"}, пустые необязательные опущены", () => {
    const onAnswer = vi.fn();
    const onInvalid = vi.fn();
    const input = {
      title: "Заявка",
      fields: [
        { name: "name", label: "Имя", kind: "text", required: true },
        { name: "age", label: "Возраст", kind: "number", min: 18, max: 99 },
        { name: "note", label: "Комментарий", kind: "text", multiline: true },
      ],
    };
    const view = widgetViewOf(call({ name: "ask_form", input }), { pending: false, onAnswer, onInvalid, fieldErrors: { age: "плохо" }, messages }) as Extract<
      ReturnType<typeof widgetViewOf>,
      { kind: "form" }
    >;
    expect(view.kind).toBe("form");
    expect(view.title).toBe("Заявка");
    expect(view.fields).toEqual([
      { name: "name", label: "Имя", kind: "text", required: true },
      { name: "age", label: "Возраст", kind: "number", required: false, min: 18, max: 99, error: "плохо" },
      { name: "note", label: "Комментарий", kind: "text", required: false, multiline: true },
    ]);
    view.onSubmit!({ name: "", age: "5" });
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith({ name: russianLabels.widgets.formRequired, age: messages.outOfRange("18", "99") });
    view.onSubmit!({ name: " Аня ", age: "30", note: "" });
    expect(onAnswer).toHaveBeenCalledWith({ "поля": { name: "Аня", age: 30 } });
    expect(onInvalid).toHaveBeenLastCalledWith({});
    const answered = widgetViewOf(call({ name: "ask_form", input, state: "answered", answer: { "поля": { name: "Аня" } } }), { pending: false, messages });
    expect(answered).toMatchObject({ values: { name: "Аня" }, active: false });
  });

  it("свой виджет: имя, вопрос из входа, содержимое страницы", () => {
    const view = widgetViewOf(call({ name: "pick_slot", input: { question: "Когда?", slots: [] } }), { pending: false, messages, content: "компонент" });
    expect(view).toMatchObject({ kind: "custom", name: "pick_slot", question: "Когда?", content: "компонент", active: true });
    const fallback = widgetViewOf(call({ name: "pick_slot", input: { slots: [] } }), { pending: false, messages });
    expect(fallback).toMatchObject({ kind: "custom", name: "pick_slot" });
    expect(fallback).not.toHaveProperty("content");
    expect(fallback).not.toHaveProperty("question");
  });

  it("негодный вход базового виджета — вида нет", () => {
    expect(widgetViewOf(call({ input: { question: "?" } }), { pending: false, messages })).toBeNull();
    expect(widgetViewOf(call({ name: "ask_form", input: { title: "x", fields: [] } }), { pending: false, messages })).toBeNull();
  });
});
