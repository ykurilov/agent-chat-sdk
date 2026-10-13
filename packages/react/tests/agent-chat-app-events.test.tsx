// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentChat } from "../src";
import type { AppEvent } from "../src";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, settle, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

const passed = { type: "lesson_passed", data: { lesson: 3 } };

const answered: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Сдаю урок" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text: "Зачёт", state: "done" }, { type: "data-app-event", data: passed }],
    metadata: { status: "complete" },
  },
];

/** Плашка события: тип и номер урока, по ним тест находит её в ленте. */
function LessonPassed({ event, messageId }: { event: AppEvent; messageId: string }) {
  return <div data-testid="lesson-passed">{`${messageId}: урок ${(event.data as { lesson: number }).lesson} зачтён`}</div>;
}

describe("AgentChat: события приложения", () => {
  it("событие из истории: свой вид внутри ответа и onAppEvent с live: false один раз", async () => {
    const onAppEvent = vi.fn();
    const server = fakeChatServer({ history: answered });
    renderAgentChat(server, { appEvents: { lesson_passed: LessonPassed }, onAppEvent });
    expect((await screen.findByTestId("lesson-passed")).textContent).toBe("a1: урок 3 зачтён");
    await settle();
    expect(onAppEvent).toHaveBeenCalledTimes(1);
    expect(onAppEvent).toHaveBeenCalledWith(passed, { live: false, messageId: "a1" });
  });

  it("тип без компонента не виден, но onAppEvent о нём сообщает", async () => {
    const onAppEvent = vi.fn();
    renderAgentChat(fakeChatServer({ history: answered }), { onAppEvent });
    await screen.findByText("Зачёт");
    await settle();
    expect(screen.queryByTestId("lesson-passed")).toBeNull();
    expect(onAppEvent).toHaveBeenCalledWith(passed, { live: false, messageId: "a1" });
  });

  it("событие в потоке ответа: вид сразу и onAppEvent с live: true, без повтора после конца хода", async () => {
    const onAppEvent = vi.fn();
    const server = fakeChatServer({ history: answered });
    renderAgentChat(server, { appEvents: { lesson_passed: LessonPassed }, onAppEvent });
    await screen.findByText("a1: урок 3 зачтён");
    await settle();
    onAppEvent.mockClear();

    const stream = await sendQuestion(server, "Следующий урок");
    stream.push({ type: "start", messageId: "a2", messageMetadata: { status: "streaming" } });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Тоже зачёт" });
    stream.push({ type: "text-end", id: "t" });
    const next = { type: "lesson_passed", data: { lesson: 4 } };
    stream.push({ type: "data-app-event", data: next });
    await screen.findByText("a2: урок 4 зачтён");
    stream.finish();
    await waitFor(() => expect(document.querySelector('[data-action="stop"]')).toBeNull());
    await settle();
    expect(onAppEvent).toHaveBeenCalledTimes(1);
    expect(onAppEvent).toHaveBeenCalledWith(next, { live: true, messageId: "a2" });
  });

  it("«Повторить»: скопированное из прежнего ответа событие (id copied:…) показано, но не живое; новое событие хода — живое", async () => {
    const onAppEvent = vi.fn();
    const server = fakeChatServer({ history: answered });
    renderAgentChat(server, { appEvents: { lesson_passed: LessonPassed }, onAppEvent });
    await screen.findByText("a1: урок 3 зачтён");
    await settle();
    onAppEvent.mockClear();

    const stream = await sendQuestion(server, "Ещё раз");
    stream.push({ type: "start", messageId: "a2", messageMetadata: { status: "streaming" } });
    stream.push({ type: "data-app-event", id: "copied:a1:1", data: passed });
    await screen.findByText("a2: урок 3 зачтён");
    const next = { type: "lesson_passed", data: { lesson: 4 } };
    stream.push({ type: "data-app-event", data: next });
    await screen.findByText("a2: урок 4 зачтён");
    stream.finish();
    await waitFor(() => expect(document.querySelector('[data-action="stop"]')).toBeNull());
    await settle();
    expect(onAppEvent.mock.calls).toEqual([
      [passed, { live: false, messageId: "a2" }],
      [next, { live: true, messageId: "a2" }],
    ]);
  });

  it("событие вне хода из канала наблюдения: onAppEvent с live: true без messageId", async () => {
    const onAppEvent = vi.fn();
    const server = fakeChatServer({ history: answered });
    server.state.watch = true;
    renderAgentChat(server, { onAppEvent });
    await waitFor(() => expect(server.watches).toHaveLength(1));
    await settle();
    onAppEvent.mockClear();
    const reminder = { type: "lesson_reminder" };
    act(() => server.emit({ type: "app-event", chatId: "c1", event: reminder }));
    await waitFor(() => expect(onAppEvent).toHaveBeenCalledTimes(1));
    expect(onAppEvent).toHaveBeenCalledWith(reminder, { live: true });
  });

  it("смена чата A→B, у B идёт ход: старые события B — live: false, события A второй раз не приходят", async () => {
    const onAppEvent = vi.fn();
    const server = fakeChatServer({ history: answered, resumable: true });
    const view = renderAgentChat(server, { onAppEvent });
    await screen.findByText("Зачёт");
    await settle();
    expect(onAppEvent).toHaveBeenCalledTimes(1);
    onAppEvent.mockClear();

    const old = { type: "b_event" };
    server.state.history = [
      { id: "bu1", role: "user", parts: [{ type: "text", text: "Вопрос B" }] },
      { id: "b1", role: "assistant", parts: [{ type: "text", text: "Ответ B", state: "done" }, { type: "data-app-event", data: old }], metadata: { status: "complete" } },
      { id: "bu2", role: "user", parts: [{ type: "text", text: "Ещё вопрос B" }] },
    ];
    server.state.running = true;
    view.rerender(<AgentChat api="/api/chat" chatId="c2" skin={stubSkin} onAppEvent={onAppEvent} />);
    await screen.findByText("Ответ B");
    await waitFor(() => expect(document.querySelector('[data-action="stop"]')).toBeTruthy());
    await settle();
    expect(onAppEvent.mock.calls).toEqual([[old, { live: false, messageId: "b1" }]]);
  });

  it("StrictMode: событие из истории — ровно один раз", async () => {
    const onAppEvent = vi.fn();
    const server = fakeChatServer({ history: answered });
    vi.stubGlobal("fetch", server.fetch);
    render(
      <StrictMode>
        <AgentChat api="/api/chat" chatId="c1" skin={stubSkin} onAppEvent={onAppEvent} />
      </StrictMode>,
    );
    await screen.findByText("Зачёт");
    await settle();
    expect(onAppEvent.mock.calls).toEqual([[passed, { live: false, messageId: "a1" }]]);
  });

  it("событие хука после «Стопа» (канал наблюдения, с messageId): live: true один раз, вид — в ответе", async () => {
    const onAppEvent = vi.fn();
    const plain: HistoryMessage[] = [answered[0]!, { ...answered[1]!, parts: [{ type: "text", text: "Зачёт", state: "done" }] }];
    const server = fakeChatServer({ history: plain });
    server.state.watch = true;
    renderAgentChat(server, { appEvents: { lesson_passed: LessonPassed }, onAppEvent });
    await waitFor(() => expect(server.watches).toHaveLength(1));
    await settle();
    expect(onAppEvent).not.toHaveBeenCalled();

    server.state.history = answered;
    act(() => server.emit({ type: "app-event", chatId: "c1", messageId: "a1", event: passed }));
    await screen.findByText("a1: урок 3 зачтён");
    await settle();
    expect(onAppEvent.mock.calls).toEqual([[passed, { live: true, messageId: "a1" }]]);
  });
});
