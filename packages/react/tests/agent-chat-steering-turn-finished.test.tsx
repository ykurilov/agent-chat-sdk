// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentChat } from "../src/agent-chat";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { steeringStubSkin } from "./support/stub-skin";
import { sendQuestion, setupChatDom } from "./support/chat-dom";
import type { ChatSkin } from "../src/skin-contract";
import type { MessageAction } from "../src/message-actions";
import { useTurnFinishedReport } from "../src/turn-finished";
import type { TurnFinishedEvent } from "../src/turn-finished";
import type { AgentChatMessage } from "../src/chat-types";

setupChatDom();

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Нарисуй кнопку" }] };
const answer = (id: string, text: string, status = "complete"): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
  metadata: { status },
});
const correctionOf = (id: string, text: string): HistoryMessage => ({ id, role: "user", parts: [{ type: "text", text }, { type: "data-agent-steer", data: true }] });

/** Скин с поправками, который рисует свои кнопки ответа. */
const skin: ChatSkin = {
  ...steeringStubSkin,
  AgentMessage: ({ children, status, actions }) => (
    <article data-kind="agent" data-status={status}>
      {children}
      {actions?.map((action) => (
        <button key={action.id} type="button" data-action={action.id} onClick={action.onRun}>
          {action.label}
        </button>
      ))}
    </article>
  ),
};

const composer = () => screen.getByLabelText("поле").closest("form")!;

/**
 * Как кнопка «Вернуть эту версию» у конструктора приложений: снимок ответа приложение узнаёт по `onTurnFinished`, и под этим ответом
 * появляется кнопка (новый массив действий — новая карта снимков).
 */
function renderWithSnapshots(server: ReturnType<typeof fakeChatServer>) {
  vi.stubGlobal("fetch", server.fetch);
  const finished: TurnFinishedEvent[] = [];
  function App() {
    const [snapshots, setSnapshots] = useState<ReadonlySet<string>>(new Set());
    const messageActions = useMemo<MessageAction[]>(
      () => [{ id: "restore", label: "Вернуть", visible: ({ message }) => snapshots.has(message.id), onRun: () => {} }],
      [snapshots],
    );
    return (
      <AgentChat
        api="/api/chat"
        chatId="c1"
        skin={skin}
        messageActions={messageActions}
        onTurnFinished={(turn) => {
          finished.push(turn);
          setSnapshots((current) => new Set([...current, turn.messageId]));
        }}
      />
    );
  }
  render(<App />);
  return { finished };
}

/** Ответ a1 идёт, человек пишет поправку; возвращает поток a1 и id поправки. */
async function steeredAnswer(server: ReturnType<typeof fakeChatServer>) {
  const stream = await sendQuestion(server, "Нарисуй кнопку");
  stream.push({ type: "start", messageId: "a1" });
  stream.push({ type: "text-start", id: "t" });
  stream.push({ type: "text-delta", id: "t", delta: "Рисую" });
  await waitFor(() => expect(screen.getByText("Рисую")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Сделай синей" } });
  fireEvent.submit(composer());
  await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
  const id = (server.requestsTo("steer")[0]!.body as { message: { id: string } }).message.id;
  return { stream, id };
}

describe("AgentChat: конец хода и кнопки ответа после поправки на лету", () => {
  it("ход по поправке подключён потоком: onTurnFinished — у каждого ответа, кнопки — под обоими", async () => {
    const server = fakeChatServer({ resumable: true });
    const app = renderWithSnapshots(server);
    const { stream, id } = await steeredAnswer(server);

    server.state.history = [question, answer("a1", "Рисую"), correctionOf(id, "Сделай синей")];
    server.state.running = true;
    stream.finish("t");
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    server.resumed[0]!.answer("Готово, синяя", "a2");
    await screen.findByText("Готово, синяя");
    await waitFor(() => expect(composer().getAttribute("data-busy")).not.toBe("true"));

    await waitFor(() => expect(app.finished.map((turn) => turn.messageId)).toEqual(["a1", "a2"]));
    expect(app.finished.every((turn) => turn.status === "complete")).toBe(true);
    await waitFor(() => expect(document.querySelectorAll('[data-action="restore"]')).toHaveLength(2));
  });

  it("ход по поправке успел закончиться до перечитывания истории: onTurnFinished — у каждого ответа", async () => {
    const server = fakeChatServer({ resumable: true });
    const app = renderWithSnapshots(server);
    const { stream, id } = await steeredAnswer(server);

    server.state.history = [question, answer("a1", "Рисую"), correctionOf(id, "Сделай синей"), answer("a2", "Готово, синяя")];
    server.state.running = false;
    stream.finish("t");
    await screen.findByText("Готово, синяя");

    await waitFor(() => expect(app.finished.map((turn) => turn.messageId)).toEqual(["a1", "a2"]));
    await waitFor(() => expect(document.querySelectorAll('[data-action="restore"]')).toHaveLength(2));
  });

  it("продолжение по поправке не стартовало (лимит, чужие ходы, чат закрыт): событие и кнопка у закрытого ответа всё равно есть", async () => {
    const server = fakeChatServer({ resumable: true });
    const app = renderWithSnapshots(server);
    const { stream, id } = await steeredAnswer(server);

    server.state.history = [question, answer("a1", "Рисую"), correctionOf(id, "Сделай синей")];
    server.state.running = false;
    stream.finish("t");
    await waitFor(() => expect(composer().getAttribute("data-busy")).not.toBe("true"));

    await waitFor(() => expect(app.finished.map((turn) => turn.messageId)).toEqual(["a1"]));
    await waitFor(() => expect(document.querySelectorAll('[data-action="restore"]')).toHaveLength(1));
  });
});

describe("useTurnFinishedReport: цепочка с поправкой", () => {
  const steeredChain = [question, answer("a1", "Рисую"), correctionOf("s1", "Сделай синей")];

  it("новый ответ в цепочке, где прежние ответы уже имели итог (например, «Переделать»), — событие только о нём", () => {
    const onTurnFinished = vi.fn();
    const { rerender } = renderHook(({ busy, messages }) => useTurnFinishedReport("c1", busy, messages, onTurnFinished), {
      initialProps: { busy: false, messages: [...steeredChain, answer("a2", "Готово")] as AgentChatMessage[] },
    });
    rerender({ busy: true, messages: [...steeredChain, answer("a3", "", "streaming")] as AgentChatMessage[] });
    rerender({ busy: false, messages: [...steeredChain, answer("a3", "Готово иначе")] as AgentChatMessage[] });
    expect(onTurnFinished.mock.calls.map(([turn]) => turn.messageId)).toEqual(["a3"]);
  });

  it("ход кончился на поправке без ответа на неё: события ответов цепочки до конца ленты", () => {
    const onTurnFinished = vi.fn();
    const { rerender } = renderHook(({ busy, messages }) => useTurnFinishedReport("c1", busy, messages, onTurnFinished), {
      initialProps: { busy: false, messages: [question] as AgentChatMessage[] },
    });
    rerender({ busy: true, messages: [question, answer("a1", "Рис", "streaming")] as AgentChatMessage[] });
    rerender({
      busy: false,
      messages: [question, answer("a1", "Рисую"), correctionOf("s1", "Синей"), answer("a2", "Синяя"), correctionOf("s2", "Крупнее")] as AgentChatMessage[],
    });
    expect(onTurnFinished.mock.calls.map(([turn]) => turn.messageId)).toEqual(["a1", "a2"]);
  });

  it("обычный ход не начался (отказ сервера): событий нет", () => {
    const onTurnFinished = vi.fn();
    const { rerender } = renderHook(({ busy, messages }) => useTurnFinishedReport("c1", busy, messages, onTurnFinished), {
      initialProps: { busy: false, messages: [question, answer("a1", "Готово")] as AgentChatMessage[] },
    });
    const next: HistoryMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Ещё" }] };
    rerender({ busy: true, messages: [question, answer("a1", "Готово"), next] as AgentChatMessage[] });
    rerender({ busy: false, messages: [question, answer("a1", "Готово"), next] as AgentChatMessage[] });
    expect(onTurnFinished).not.toHaveBeenCalled();
  });

  it("«Стоп» при ждущей поправке: остановленный ответ — со своим итогом", () => {
    const onTurnFinished = vi.fn();
    const { rerender } = renderHook(({ busy, messages }) => useTurnFinishedReport("c1", busy, messages, onTurnFinished), {
      initialProps: { busy: false, messages: [question] as AgentChatMessage[] },
    });
    rerender({ busy: true, messages: [question, answer("a1", "Рис", "streaming")] as AgentChatMessage[] });
    rerender({ busy: false, messages: [question, answer("a1", "Рис", "stopped"), correctionOf("s1", "Синей"), answer("a2", "Готово")] as AgentChatMessage[] });
    expect(onTurnFinished.mock.calls.map(([turn]) => [turn.messageId, turn.status])).toEqual([
      ["a1", "stopped"],
      ["a2", "complete"],
    ]);
  });
});
