// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "../../src/agent-panel/agent-panel";
import { AgentPanelProvider } from "../../src/agent-panel/agent-panel-provider";
import { useAgentDataChanges } from "../../src/agent-panel/agent-panel-hooks";
import type { AgentAppBridge, AppDataChange } from "../../src/app-bridge/app-bridge";
import { fakeChatListServer } from "../support/fake-chat-list-server";
import { fakeChatServer } from "../support/fake-chat-server";
import { renderChatHook, setupChatDom, submitQuestion } from "../support/chat-dom";
import { stubPanelSkin } from "../support/stub-agent-panel-skin";

setupChatDom();
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const changePart = (id: string, tag: string, details?: unknown) => ({
  type: "data-app-change",
  id,
  data: { tag, ...(details !== undefined && { details }) },
  transient: true,
});

describe("useAgentChat: сообщение об изменении данных из потока (FR-018)", () => {
  function bridgeRecording() {
    const received: AppDataChange[] = [];
    const bridge: AgentAppBridge = {
      tabId: "tab-1",
      currentPlace: () => null,
      dataChanged: (change) => received.push(change),
      browserCall: async () => ({ error: "нет" }),
    };
    return { bridge, received };
  }

  it("кусок data-app-change уходит в мост сразу, не дожидаясь конца ответа; в сообщение не попадает", async () => {
    const server = fakeChatServer();
    const { bridge, received } = bridgeRecording();
    const { result } = renderChatHook(server, { appBridge: bridge });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("создай задачу"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;
    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push(changePart("m1", "tasks", { taskId: 7 }));
    });
    await waitFor(() => expect(received).toEqual([{ id: "m1", tag: "tasks", details: { taskId: 7 } }]));
    expect(result.current.busy).toBe(true);
    act(() => stream.finish());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(JSON.stringify(result.current.messages)).not.toContain("data-app-change");
  });

  it("повтор того же куска (реестр повторяет ход новому слушателю) приходит в мост ещё раз с тем же id — снимает повтор сам мост", async () => {
    const server = fakeChatServer();
    const { bridge, received } = bridgeRecording();
    const { result } = renderChatHook(server, { appBridge: bridge });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("создай задачу"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push(changePart("m1", "tasks"));
      server.streams[0]!.push(changePart("m2", "clients"));
    });
    await waitFor(() => expect(received.map((item) => item.id)).toEqual(["m1", "m2"]));
    act(() => server.streams[0]!.finish());
  });

  it("без моста кусок молча пропускается", async () => {
    const server = fakeChatServer();
    const { result } = renderChatHook(server, {});
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("создай задачу"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push(changePart("m1", "tasks"));
      server.streams[0]!.finish();
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
  });
});

describe("AgentPanel: сообщение доходит при закрытой панели (FR-019)", () => {
  it("подписчик на странице зовётся один раз, хотя панель закрыта; повтор id не раздаётся", async () => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    vi.stubGlobal("fetch", server.fetch);
    const handler = vi.fn();
    const onAll = vi.fn();
    function TaskList() {
      useAgentDataChanges("tasks", handler);
      return null;
    }
    render(
      <AgentPanelProvider api="/api/chat" userKey="ivan" onDataChanged={onAll}>
        <TaskList />
        <AgentPanel skin={stubPanelSkin} />
      </AgentPanelProvider>,
    );
    expect(screen.getByTestId("launcher").getAttribute("aria-expanded")).toBe("false");
    await screen.findByLabelText("поле");
    submitQuestion("создай задачу");
    await waitFor(() => expect(server.chatServer.streams).toHaveLength(1));
    const stream = server.chatServer.streams[0]!;
    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push(changePart("m1", "tasks", { taskId: 7 }));
      stream.push(changePart("m1", "tasks", { taskId: 7 }));
      stream.push(changePart("m2", "clients"));
    });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler).toHaveBeenCalledWith({ id: "m1", tag: "tasks", details: { taskId: 7 } });
    expect(onAll).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("launcher").getAttribute("aria-expanded")).toBe("false");
    act(() => stream.finish());
  });
});
