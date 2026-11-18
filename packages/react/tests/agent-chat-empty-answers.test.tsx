// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatSkin } from "../src/skin-contract";
import { russianLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import { steeringStubSkin } from "./support/stub-skin";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";

setupChatDom();

/*
 * Ответ без текста не рисуется пустой карточкой (договор скина 34): закрытый ради поправки без видимых частей не
 * показывается совсем, с шагами — только шаги (без строки «модель не дала ответа», без копирования и подписи модели);
 * остановленный и оборванный до первого слова — понятной строкой, «Повторить» на месте.
 */

/** Скин-заглушка, который показывает всё, что получает ответ: так видно, что решил слой поведения. */
const skin: ChatSkin = {
  ...steeringStubSkin,
  AgentMessage: ({ status, children, empty, emptyText, onRetry, onRegenerate, modelDetails }) => (
    <article data-kind="agent" data-status={status} data-empty={String(empty)} {...(emptyText !== undefined && { "data-empty-text": emptyText })} {...(modelDetails && { "data-model": modelDetails.modelId })}>
      <div data-parts>{children}</div>
      {onRetry && <button type="button">{russianLabels.retry}</button>}
      {onRegenerate && <button type="button">{russianLabels.regenerate}</button>}
    </article>
  ),
};

const steer = { type: "data-agent-steer", data: true };
const question = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", text }] });
const hidden = [{ type: "data-frozen-context", data: { blocks: [] } }, { type: "step-start" }, { type: "data-answer-reasoning", data: { level: "low" } }];
const look = (id: string) => ({ type: "dynamic-tool", toolName: "view_result", toolCallId: id, state: "output-available", input: {}, output: { status: "ready" } });
const meta = (status: string) => ({ status, modelId: "m", providerId: "p" });

async function rendered(history: unknown[], forks?: { messageId: string; siblingIds: string[] }[]) {
  const server = fakeChatServer({ history: history as never });
  if (forks) server.state.forks = forks;
  const view = renderAgentChat(server, { skin, answerDetails: true });
  await screen.findByText("последний вопрос");
  return [...view.container.querySelectorAll<HTMLElement>('[data-kind="agent"]')];
}

describe("ответ без текста — не пустая карточка", () => {
  it("закрытый ради поправки без видимых частей не показывается; ответ на поправку — на месте", async () => {
    const answers = await rendered([
      question("u1", "Посмотри"),
      { id: "a1", role: "assistant", parts: hidden, metadata: meta("complete") },
      { id: "s1", role: "user", parts: [{ type: "text", text: "И ярче" }, steer] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Сделал ярче" }], metadata: meta("complete") },
      question("u2", "последний вопрос"),
      { id: "a3", role: "assistant", parts: [{ type: "text", text: "Ответ" }], metadata: meta("complete") },
    ]);
    expect(answers.map((answer) => answer.textContent)).toEqual(["Сделал ярче", expect.stringContaining("Ответ")]);
  });

  it("закрытый ради поправки с шагами: только шаги — без строки, копирования и подписи модели", async () => {
    const answers = await rendered([
      question("u1", "Посмотри"),
      { id: "a1", role: "assistant", parts: [...hidden.slice(0, 2), look("c1"), look("c2"), hidden[2]], metadata: meta("complete") },
      { id: "s1", role: "user", parts: [{ type: "text", text: "И ярче" }, steer] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Сделал ярче" }], metadata: meta("complete") },
      question("u2", "последний вопрос"),
    ]);
    const closed = answers[0]!;
    expect(closed.querySelectorAll('[data-parts] > *').length).toBe(2);
    expect(closed.getAttribute("data-empty")).toBe("false");
    expect(closed.getAttribute("data-empty-text")).toBe("");
    expect(closed.hasAttribute("data-model")).toBe(false);
    expect(answers[1]!.getAttribute("data-model")).toBe("m");
    expect(answers[1]!.hasAttribute("data-empty-text")).toBe(false);
  });

  it("«Стоп» до первого слова: строка «ответ остановлен», «Повторить» на месте", async () => {
    const answers = await rendered([
      question("u1", "последний вопрос"),
      { id: "a1", role: "assistant", parts: [...hidden, { type: "text", text: "  " }], metadata: meta("stopped") },
    ]);
    const stopped = answers.at(-1)!;
    expect(stopped.getAttribute("data-empty")).toBe("true");
    expect(stopped.getAttribute("data-empty-text")).toBe(russianLabels.answerStoppedEmpty);
    // Пустой текст — не часть ответа: тела у такого ответа нет.
    expect(stopped.querySelectorAll('[data-parts] > *').length).toBe(0);
    expect(screen.getByRole("button", { name: russianLabels.retry })).toBeTruthy();
  });

  it("обрыв до первого слова — своя строка; модель промолчала — прежняя «модель не дала ответа»", async () => {
    const answers = await rendered([
      question("u1", "Раз"),
      { id: "a1", role: "assistant", parts: hidden, metadata: meta("interrupted") },
      question("u2", "последний вопрос"),
      { id: "a2", role: "assistant", parts: hidden, metadata: meta("complete") },
    ]);
    expect(answers.map((answer) => answer.getAttribute("data-empty-text"))).toEqual([russianLabels.answerInterruptedEmpty, russianLabels.answerEmpty]);
  });

  it("остановлен на шагах без текста: без строки — шаги и отметка «Остановлено» всё объясняют", async () => {
    const answers = await rendered([
      question("u1", "последний вопрос"),
      { id: "a1", role: "assistant", parts: [...hidden, look("c1")], metadata: meta("stopped") },
    ]);
    expect(answers.at(-1)!.getAttribute("data-empty")).toBe("true");
    expect(answers.at(-1)!.getAttribute("data-empty-text")).toBe("");
  });

  it("«Стоп» при ждущей поправке до первого слова: ответ виден, строка «остановлен до начала»", async () => {
    const answers = await rendered([
      question("u1", "Посмотри"),
      { id: "a1", role: "assistant", parts: hidden, metadata: meta("stopped") },
      { id: "s1", role: "user", parts: [{ type: "text", text: "последний вопрос" }, steer] },
    ]);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.getAttribute("data-status")).toBe("stopped");
    expect(answers[0]!.getAttribute("data-empty-text")).toBe(russianLabels.answerStoppedEmpty);
  });

  it.each([
    ["с ошибкой", { parts: hidden, metadata: { ...meta("error"), error: { kind: "overloaded" } } }],
    ["ждёт подтверждения", { parts: hidden, metadata: meta("awaiting_approval") }],
    ["обрезан по длине", { parts: [...hidden, { type: "data-length-cut", data: true }], metadata: meta("complete") }],
    ["не доставлен", { parts: hidden, metadata: { ...meta("complete"), undelivered: true } }],
  ])("закрытый ради поправки без текста, но %s — остаётся на экране", async (_, answer) => {
    const answers = await rendered([
      question("u1", "Посмотри"),
      { id: "a1", role: "assistant", ...answer },
      { id: "s1", role: "user", parts: [{ type: "text", text: "последний вопрос" }, steer] },
    ]);
    expect(answers.map((element) => element.getAttribute("data-status"))).toEqual([answer.metadata.status]);
  });

  it("закрытый ради поправки без текста, но с соседними вариантами — остаётся: переключатель веток на месте", async () => {
    const answers = await rendered(
      [
        question("u1", "Посмотри"),
        { id: "a1", role: "assistant", parts: hidden, metadata: meta("complete") },
        { id: "s1", role: "user", parts: [{ type: "text", text: "последний вопрос" }, steer] },
      ],
      [{ messageId: "a1", siblingIds: ["a0", "a1"] }],
    );
    expect(answers).toHaveLength(1);
    expect(answers[0]!.getAttribute("data-empty-text")).toBe("");
  });

  it.each([
    ["только раздумье — ответ начался: без строки", [{ type: "reasoning", text: "Думаю", state: "done" }], ""],
    ["только подсказки ответа — не начался", [{ type: "tool-suggest_replies", toolCallId: "r1", state: "output-available", input: { replies: ["Да"] }, output: {} }], russianLabels.answerStoppedEmpty],
  ])("остановлен: %s — как у диктора", async (_, parts, line) => {
    const answers = await rendered([
      question("u1", "последний вопрос"),
      { id: "a1", role: "assistant", parts, metadata: meta("stopped") },
    ]);
    expect(answers.at(-1)!.getAttribute("data-empty-text")).toBe(line);
  });

  it("ответ с текстом — как раньше: строки нет", async () => {
    const answers = await rendered([
      question("u1", "последний вопрос"),
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Начал" }], metadata: meta("stopped") },
    ]);
    expect(answers.at(-1)!.getAttribute("data-empty")).toBe("false");
    expect(answers.at(-1)!.hasAttribute("data-empty-text")).toBe(false);
  });
});
