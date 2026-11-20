// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubWorkSkin } from "./support/stub-work-skin";
import type { ChatSkin } from "../src/skin-contract";
import type { NoticeLines } from "../src/agent-chat-extensions";

setupChatDom();

// Договор 37: ответ после невидимого служебного сообщения (сервер разбудил агента) — продолжение прошлого ответа.
// Прошлый ответ получает `continued`: без «Копировать» и без нижнего отступа; «Копировать» последнего копирует всю цепочку.

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Нарисуй кота" }] };
const started: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Запустил генерацию." }], metadata: { status: "complete" } };
const wake: HistoryMessage = {
  id: "n1",
  role: "user",
  parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "app", name: "generations_finished", data: {} }] } }],
};
const finished: HistoryMessage = {
  id: "a2",
  role: "assistant",
  parts: [
    { type: "tool-view_result", toolCallId: "c1", state: "output-available", input: {}, output: "ok" },
    { type: "text", text: "Обе работы готовы." },
  ],
  metadata: { status: "complete" },
};

const chainSkin: ChatSkin = {
  ...stubWorkSkin,
  ServiceLine: ({ text }) => <p data-kind="service-line">{text}</p>,
  AgentMessage: ({ children, onCopy, continued, followsPrevious }) => (
    <article data-kind="agent" data-continued={String(Boolean(continued))} data-follows={String(Boolean(followsPrevious))}>
      {children}
      <button type="button" data-action="copy" onClick={onCopy} />
    </article>
  ),
};

const followsFlags = () => Array.from(document.querySelectorAll('[data-kind="agent"]')).map((element) => element.getAttribute("data-follows"));
const continuedFlags = () => Array.from(document.querySelectorAll('[data-kind="agent"]')).map((element) => element.getAttribute("data-continued"));

describe("AgentChat: ответ после невидимого служебного сообщения — продолжение прошлого (договор 37)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("прошлый ответ помечен continued, последний — нет", async () => {
    renderAgentChat(fakeChatServer({ history: [question, started, wake, finished] }), { skin: chainSkin });
    await waitFor(() => expect(continuedFlags()).toEqual(["true", "false"]));
    expect(followsFlags()).toEqual(["false", "true"]);
  });

  it("законченный ответ без текста (ошибка) цепочку рвёт: «Копировать» остаётся у прошлого ответа", async () => {
    const failed: HistoryMessage = {
      id: "a2",
      role: "assistant",
      parts: [],
      metadata: { status: "error", error: { kind: "other", message: "сбой" } },
    };
    renderAgentChat(fakeChatServer({ history: [question, started, wake, failed] }), { skin: chainSkin });
    await waitFor(() => expect(document.querySelectorAll('[data-kind="agent"]')).toHaveLength(2));
    expect(continuedFlags()).toEqual(["false", "false"]);
  });

  it("«Копировать» последнего ответа цепочки копирует всю цепочку", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAgentChat(fakeChatServer({ history: [question, started, wake, finished] }), { skin: chainSkin });
    await waitFor(() => expect(continuedFlags()).toEqual(["true", "false"]));
    const copies = document.querySelectorAll<HTMLButtonElement>('[data-action="copy"]');
    fireEvent.click(copies[copies.length - 1]!);
    expect(writeText).toHaveBeenCalledWith("Запустил генерацию.\n\nОбе работы готовы.");
  });

  it("свои кнопки приложения — только у последнего ответа цепочки, текст в них — вся цепочка", async () => {
    const onRun = vi.fn();
    const actionSkin: ChatSkin = {
      ...chainSkin,
      AgentMessage: ({ children, continued, actions }) => (
        <article data-kind="agent" data-continued={String(Boolean(continued))}>
          {children}
          {actions?.map((action) => <button key={action.id} type="button" data-action={action.id} onClick={action.onRun} />)}
        </article>
      ),
    };
    renderAgentChat(fakeChatServer({ history: [question, started, wake, finished] }), { skin: actionSkin, messageActions: [{ id: "like", label: "Нравится", onRun }] });
    await waitFor(() => expect(continuedFlags()).toEqual(["true", "false"]));
    const likes = Array.from(document.querySelectorAll('[data-kind="agent"]')).map((answer) => answer.querySelectorAll('[data-action="like"]').length);
    expect(likes).toEqual([0, 1]);
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-action="like"]')!);
    await waitFor(() => expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ messageId: "a2", text: "Запустил генерацию.\n\nОбе работы готовы." })));
  });

  it("ответы подряд без сообщения между ними (служебное сообщение сервер не отдал) — тоже цепочка", async () => {
    renderAgentChat(fakeChatServer({ history: [question, started, finished] }), { skin: chainSkin });
    await waitFor(() => expect(continuedFlags()).toEqual(["true", "false"]));
  });

  it("видимая строка пометки между ответами — не цепочка", async () => {
    const noticeLines: NoticeLines = { generations_finished: () => "Генерации готовы" };
    renderAgentChat(fakeChatServer({ history: [question, started, wake, finished] }), { skin: chainSkin, noticeLines });
    await waitFor(() => expect(screen.getByTestId("feed").textContent).toContain("Генерации готовы"));
    expect(continuedFlags()).toEqual(["false", "false"]);
  });

  it("пометка со строкой, но скин без ServiceLine — строки не видно: цепочка", async () => {
    const noticeLines: NoticeLines = { generations_finished: () => "Генерации готовы" };
    const { ServiceLine: _line, ...withoutLine } = chainSkin;
    renderAgentChat(fakeChatServer({ history: [question, started, wake, finished] }), { skin: withoutLine, noticeLines });
    await waitFor(() => expect(continuedFlags()).toEqual(["true", "false"]));
  });

  it("плашка задачи (видимое служебное сообщение) и сообщение человека между ответами — не цепочка", async () => {
    const taskDone: HistoryMessage = {
      id: "n2",
      role: "user",
      parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "task_done", taskId: "t1", title: "Отчёт", result: "готово" }] } }],
    };
    const again: HistoryMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Ещё" }] };
    renderAgentChat(fakeChatServer({ history: [question, started, taskDone, finished, again, { ...started, id: "a3" }] }), { skin: chainSkin });
    await waitFor(() => expect(continuedFlags()).toEqual(["false", "false", "false"]));
  });
});
