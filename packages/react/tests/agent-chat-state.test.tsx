// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { AgentChat } from "../src/agent-chat";
import { describe, expect, it, vi } from "vitest";
import type { ChatSkin } from "../src/skin-contract";
import { useChatState } from "../src/chat-state/chat-state";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, renderChatHook, sendQuestion, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Запиши почту" }] };
const answer: HistoryMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    { type: "data-app-state", data: { set: { "fields.email": "a@x.ru", "fields.phone": "+7" } } },
    { type: "data-app-state", data: { unset: ["fields.phone"] } },
    { type: "text", text: "Записал", state: "done" },
  ],
  metadata: { status: "complete" },
};
const otherAnswer: HistoryMessage = { id: "a0", role: "assistant", parts: [{ type: "text", text: "Без почты", state: "done" }], metadata: { status: "complete" } };

/** Скин, который показывает состояние чата из `useChatState()` под каждым ответом. */
const stateSkin: ChatSkin = {
  ...stubSkin,
  AgentMessage: (props) => {
    const state = useChatState();
    return (
      <>
        <stubSkin.AgentMessage {...props} />
        <output data-kind="chat-state">{JSON.stringify(state)}</output>
      </>
    );
  },
};

const shownState = () => [...document.querySelectorAll('[data-kind="chat-state"]')].map((node) => node.textContent);

describe("состояние чата на экране", () => {
  it("по истории: onStateChange и useChatState получают свёртку записей ветки", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    const onStateChange = vi.fn();
    renderAgentChat(server, { skin: stateSkin, onStateChange });
    await screen.findByText("Записал");
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ fields: { email: "a@x.ru" } }));
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(shownState()).toEqual([JSON.stringify({ fields: { email: "a@x.ru" } })]);
  });

  it("живьём: запись в потоке ответа сразу меняет состояние", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.chatState).toEqual({ fields: { email: "a@x.ru" } }));
    act(() => result.current.setValue("Ещё телефон"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;
    stream.push({ type: "start", messageId: "a2" });
    stream.push({ type: "data-app-state", data: { set: { "fields.phone": "+7 900" } } });
    await waitFor(() => expect(result.current.chatState).toEqual({ fields: { email: "a@x.ru", phone: "+7 900" } }));
    stream.finish();
  });

  it("смена ветки — состояние новой ветки", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    server.state.forks = [{ messageId: "a1", siblingIds: ["a0", "a1"] }];
    server.state.branchTo.a0 = { messages: [question, otherAnswer], forks: [{ messageId: "a0", siblingIds: ["a0", "a1"] }] };
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.chatState).toEqual({ fields: { email: "a@x.ru" } }));
    await act(async () => void (await result.current.selectBranch("a0")));
    expect(result.current.chatState).toEqual({});
  });

  it("другая вкладка сменила состояние: событие state-changed обновляет chatState и onStateChange", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    server.state.watch = true;
    const onStateChange = vi.fn();
    renderAgentChat(server, { skin: stateSkin, onStateChange });
    await waitFor(() => expect(server.watches).toHaveLength(1));
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ fields: { email: "a@x.ru" } }));

    const changed = { fields: { email: "b@x.ru" } };
    act(() => server.emit({ type: "state-changed", ownerId: "u", chatId: "c1", reason: "editAnswer", state: changed, atMessageId: "a1" }));
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith(changed));
    expect(shownState()).toEqual([JSON.stringify(changed)]);
  });

  it("событие state-changed с тем же состоянием ничего не меняет", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    server.state.watch = true;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    const before = result.current.chatState;
    act(() => server.emit({ type: "state-changed", ownerId: "u", chatId: "c1", reason: "turn", state: { fields: { email: "a@x.ru" } }, atMessageId: "a1" }));
    act(() => server.emit({ type: "tasks-changed", ownerId: "u", chatId: "c1" }));
    expect(result.current.chatState).toBe(before);
  });

  it("служебные ключи, если сервер их прислал, на экран не попадают", async () => {
    const leaked: HistoryMessage = { ...answer, parts: [{ type: "data-app-state", data: { set: { $closed: { code: "x", message: "y" }, "fields.a": 1 } } }, ...answer.parts.slice(2)] };
    const server = fakeChatServer({ history: [question, leaked] });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.chatState).toEqual({ fields: { a: 1 } }));
  });
});

/** Панель рядом с чатом: состояние чата `chatId` вне `AgentChat`. */
function StatePanel({ chatId }: { chatId: string }) {
  const state = useChatState(chatId);
  return <output data-kind={`panel-${chatId}`}>{JSON.stringify(state)}</output>;
}

const panelState = (chatId: string) => document.querySelector(`[data-kind="panel-${chatId}"]`)?.textContent;

describe("состояние чата вне AgentChat: useChatState(chatId)", () => {
  it("панель рядом с чатом видит то же состояние без своих запросов; чужой chatId — пусто", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    vi.stubGlobal("fetch", server.fetch);
    render(
      <>
        <AgentChat api="/api/chat" chatId="c1" skin={stubSkin} />
        <StatePanel chatId="c1" />
        <StatePanel chatId="c2" />
      </>,
    );
    expect(panelState("c1")).toBe("{}");
    await waitFor(() => expect(panelState("c1")).toBe(JSON.stringify({ fields: { email: "a@x.ru" } })));
    expect(panelState("c2")).toBe("{}");
    expect(server.requestsTo("history")).toHaveLength(1);
    expect(server.requests.some((request) => request.url.includes("/c2"))).toBe(false);
  });

  it("живьём: запись по ходу ответа доходит до панели; чат ушёл со страницы — пусто", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    vi.stubGlobal("fetch", server.fetch);
    const { rerender } = render(
      <>
        <AgentChat api="/api/chat" chatId="c1" skin={stubSkin} />
        <StatePanel chatId="c1" />
      </>,
    );
    await waitFor(() => expect(panelState("c1")).toBe(JSON.stringify({ fields: { email: "a@x.ru" } })));

    const stream = await sendQuestion(server, "Ещё телефон");
    stream.push({ type: "start", messageId: "a2" });
    stream.push({ type: "data-app-state", data: { set: { "fields.phone": "+7 900" } } });
    await waitFor(() => expect(panelState("c1")).toBe(JSON.stringify({ fields: { email: "a@x.ru", phone: "+7 900" } })));
    stream.finish();
    rerender(<StatePanel chatId="c1" />);
    expect(panelState("c1")).toBe("{}");
  });

  it("событие другой вкладки (state-changed, в том числе ответ виджета) доходит до панели", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    server.state.watch = true;
    vi.stubGlobal("fetch", server.fetch);
    render(
      <>
        <AgentChat api="/api/chat" chatId="c1" skin={stubSkin} />
        <StatePanel chatId="c1" />
      </>,
    );
    await waitFor(() => expect(server.watches).toHaveLength(1));
    await waitFor(() => expect(panelState("c1")).toBe(JSON.stringify({ fields: { email: "a@x.ru" } })));
    const changed = { fields: { email: "b@x.ru" } };
    act(() => server.emit({ type: "state-changed", ownerId: "u", chatId: "c1", reason: "widgetAnswer", state: changed, atMessageId: "a1" }));
    await waitFor(() => expect(panelState("c1")).toBe(JSON.stringify(changed)));
  });

  it("смена chatId без key: пока история нового чата грузится — пусто, состояние прежнего чата под новым id не появляется", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    vi.stubGlobal("fetch", server.fetch);
    const seenUnderC2: string[] = [];
    function LoggedPanel() {
      const state = useChatState("c2");
      seenUnderC2.push(JSON.stringify(state));
      return null;
    }
    const page = (chatId: string) => (
      <>
        <AgentChat api="/api/chat" chatId={chatId} skin={stubSkin} />
        <StatePanel chatId="c1" />
        <LoggedPanel />
      </>
    );
    const { rerender } = render(page("c1"));
    await waitFor(() => expect(panelState("c1")).toBe(JSON.stringify({ fields: { email: "a@x.ru" } })));

    let releaseHistory!: () => void;
    server.state.gate.history = new Promise<void>((resolve) => (releaseHistory = resolve));
    rerender(page("c2"));
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(2));
    expect(panelState("c1")).toBe("{}");

    const c2State = { fields: { email: "c2@x.ru" } };
    server.state.history = [question, { ...answer, parts: [{ type: "data-app-state", data: { set: { "fields.email": "c2@x.ru" } } }] }];
    await act(async () => releaseHistory());
    await waitFor(() => expect(seenUnderC2.at(-1)).toBe(JSON.stringify(c2State)));
    expect(seenUnderC2.filter((seen) => seen !== "{}" && seen !== JSON.stringify(c2State))).toEqual([]);
  });

  it("useAgentChat: смена chatId без key не публикует состояние прежнего чата под новым id", async () => {
    const server = fakeChatServer({ history: [question, answer] });
    const seenUnderC2: string[] = [];
    renderHook(() => {
      const state = useChatState("c2");
      seenUnderC2.push(JSON.stringify(state));
    });
    const { result, rerender } = renderChatHook(server);
    await waitFor(() => expect(result.current.chatState).toEqual({ fields: { email: "a@x.ru" } }));

    server.state.gate.history = new Promise<void>(() => {});
    rerender({ chatId: "c2" });
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(2));
    await act(async () => {});
    expect(seenUnderC2.filter((seen) => seen !== "{}")).toEqual([]);
  });

  it("служебные ключи до панели не доходят", async () => {
    const leaked: HistoryMessage = { ...answer, parts: [{ type: "data-app-state", data: { set: { $closed: { code: "x", message: "y" }, "fields.a": 1 } } }] };
    const server = fakeChatServer({ history: [question, leaked] });
    vi.stubGlobal("fetch", server.fetch);
    render(
      <>
        <AgentChat api="/api/chat" chatId="c1" skin={stubSkin} />
        <StatePanel chatId="c1" />
      </>,
    );
    await waitFor(() => expect(panelState("c1")).toBe(JSON.stringify({ fields: { a: 1 } })));
  });
});
