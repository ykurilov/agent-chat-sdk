// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentChatMessage, ChatMessageMetadata } from "../src/chat-types";
import { useFeedAnnouncement } from "../src/feed-announcement";
import { russianLabels } from "../src/labels";

const question: AgentChatMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Сколько будет 2+2?" }] };

const voiceQuestion: AgentChatMessage = { ...question, parts: [...question.parts, { type: "data-voice-mode", data: true }] };

function answer(text: string, metadata: ChatMessageMetadata = { status: "complete" }): AgentChatMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: text ? [{ type: "text", text, state: "done" }] : [],
    metadata,
  };
}

function watch(initial: { messages: AgentChatMessage[]; busy: boolean }) {
  return renderHook((props: { messages: AgentChatMessage[]; busy: boolean }) => useFeedAnnouncement(props.messages, props.busy), {
    initialProps: initial,
  });
}

/** Ответ шёл во вкладке и закончился: возвращает то, что услышит диктор. */
function finishedAnswer(final: AgentChatMessage) {
  const view = watch({ messages: [question, answer("", { status: "streaming" })], busy: true });
  view.rerender({ messages: [question, final], busy: false });
  return view.result.current;
}

describe("текст для диктора", () => {
  it("при открытии чата — пустая строка: старые ответы не зачитываются", () => {
    const { result } = watch({ messages: [question, answer("Четыре")], busy: false });
    expect(result.current).toBe("");
  });

  it("теги голоса в ответе голосового хода диктору не зачитываются", () => {
    const view = watch({ messages: [voiceQuestion, answer("", { status: "streaming" })], busy: true });
    view.rerender({ messages: [voiceQuestion, answer("[laughs] Ну вот [sighs] четыре [1].")], busy: false });
    expect(view.result.current).toBe("Ну вот четыре [1].");
  });

  it("в ответе текстового хода скобки читаются как есть", () => {
    expect(finishedAnswer(answer("Смотри [docs] и [laughs]."))).toBe("Смотри [docs] и [laughs].");
  });

  it.each([
    ["жирный и курсив", "Это **Языковая модель** и *курсив*, а ещё __так__ и _так_.", "Это Языковая модель и курсив, а ещё так и так."],
    ["заголовки", "# Итог\n\n### Подробнее\nТекст", "Итог\n\nПодробнее\nТекст"],
    ["ссылка — остаётся текст", "Смотри [документацию](https://example.com/a_b_c) тут", "Смотри документацию тут"],
    ["картинка — подпись", "![схема](https://example.com/s.png)", "схема"],
    ["строчный код", "Вызови `run()` сейчас", "Вызови run() сейчас"],
    ["блок кода", "Пример:\n```ts\nconst a = 1;\n```\nвсё", "Пример:\nconst a = 1;\nвсё"],
    ["маркированный список", "- один\n* два\n+ три", "один\nдва\nтри"],
    ["нумерованный список", "1. один\n2. два", "1. один\n2. два"],
    ["цитата", "> мудрая мысль\n> вторая", "мудрая мысль\nвторая"],
    ["зачёркнутое и разделитель", "~~старое~~\n\n---\nновое", "старое\n\nновое"],
    ["скобки без ссылки остаются", "Смотри [1] и [docs]", "Смотри [1] и [docs]"],
    ["умножение не курсив", "2 * 3 * 4 и snake_case_name", "2 * 3 * 4 и snake_case_name"],
    ["умножение без пробелов", "Итого 5*6*7 = 210", "Итого 5*6*7 = 210"],
    ["шаблоны путей", "Смотри src/*.ts и lib/*.js", "Смотри src/*.ts и lib/*.js"],
    ["имя из кода с двумя подчёркиваниями", "Метод __init__ вызывается первым", "Метод __init__ вызывается первым"],
    ["«больше» в начале строки — не цитата", "> 100 000 ₽ — дорого\n>5 штук", "> 100 000 ₽ — дорого\n>5 штук"],
    ["решётка в конце обычной строки остаётся", "Пишу на C #", "Пишу на C #"],
    ["закрывающие решётки заголовка снимаются", "## Итог ##", "Итог"],
    ["выделение у скобок и кавычек", "(**важно**) и «*тихо*»", "(важно) и «тихо»"],
  ])("в ответе нет разметки: %s", (_, markdown, spoken) => {
    expect(finishedAnswer(answer(markdown))).toBe(spoken);
  });

  it("ответ закончился во вкладке — его текст", () => {
    expect(finishedAnswer(answer("Четыре"))).toBe("Четыре");
  });

  it.each([
    ["остановлен", answer("Че", { status: "stopped" }), russianLabels.answerStopped],
    ["прерван", answer("Че", { status: "interrupted" }), russianLabels.answerInterrupted],
    ["ошибка", answer("", { status: "error", error: { kind: "overloaded" } }), russianLabels.errors.overloaded],
    ["ошибка без вида", answer("", { status: "error" }), russianLabels.errors.other],
    ["пустой ответ", answer(""), russianLabels.answerEmpty],
  ])("ответ закончился: %s — надпись вместо текста", (_, final, label) => {
    expect(finishedAnswer(final)).toBe(label);
  });

  it("пока ответ растёт, прежний текст не меняется", () => {
    const view = watch({ messages: [question, answer("Четыре")], busy: false });
    view.rerender({ messages: [question, answer("Четыре"), { id: "u2", role: "user", parts: [{ type: "text", text: "А 3+3?" }] }], busy: true });
    view.rerender({
      messages: [question, answer("Четыре"), { id: "u2", role: "user", parts: [] }, { id: "a2", role: "assistant", parts: [{ type: "text", text: "Ше", state: "streaming" }], metadata: { status: "streaming" } }],
      busy: true,
    });

    expect(view.result.current).toBe("");
  });

  it("второй ответ во вкладке заменяет текст первого", () => {
    const view = watch({ messages: [question], busy: false });
    view.rerender({ messages: [question, answer("Четыре", { status: "streaming" })], busy: true });
    view.rerender({ messages: [question, answer("Четыре")], busy: false });
    expect(view.result.current).toBe("Четыре");

    const second: AgentChatMessage = { id: "a2", role: "assistant", parts: [{ type: "text", text: "Шесть", state: "done" }], metadata: { status: "complete" } };
    view.rerender({ messages: [question, answer("Четыре"), second], busy: true });
    view.rerender({ messages: [question, answer("Четыре"), second], busy: false });
    expect(view.result.current).toBe("Шесть");
  });

  it("новый ответ начался — текст прошлого убран, чтобы такой же итог прозвучал снова", () => {
    const view = watch({ messages: [question], busy: false });
    const stopped = answer("Че", { status: "stopped" });
    view.rerender({ messages: [question, answer("", { status: "streaming" })], busy: true });
    view.rerender({ messages: [question, stopped], busy: false });
    expect(view.result.current).toBe(russianLabels.answerStopped);

    view.rerender({ messages: [question, stopped, answer("", { status: "streaming" })], busy: true });
    expect(view.result.current).toBe("");
    view.rerender({ messages: [question, stopped, stopped], busy: false });
    expect(view.result.current).toBe(russianLabels.answerStopped);
  });

  it("чат сменился, пока шёл ответ: итог нового чата не зачитывается", () => {
    const view = renderHook((props: { messages: AgentChatMessage[]; busy: boolean; chatId: string }) => useFeedAnnouncement(props.messages, props.busy, props.chatId), {
      initialProps: { messages: [question, answer("", { status: "streaming" })], busy: true, chatId: "a" },
    });
    view.rerender({ messages: [question, answer("Четыре")], busy: false, chatId: "b" });
    expect(view.result.current).toBe("");
  });
});
