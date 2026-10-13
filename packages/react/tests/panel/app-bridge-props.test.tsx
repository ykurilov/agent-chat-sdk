// @vitest-environment jsdom
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAppBridge } from "../../src/app-bridge/app-bridge";
import { ChatWorkspace } from "../../src/chat-list/chat-workspace";
import { useChatList } from "../../src/chat-list/use-chat-list";
import { fakeChatListServer } from "../support/fake-chat-list-server";
import { fakeChatServer } from "../support/fake-chat-server";
import { renderAgentChat, renderChatHook, setupChatDom } from "../support/chat-dom";
import { stubWorkspaceSkin } from "../support/stub-chat-list-skin";

setupChatDom();
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const bridge: AgentAppBridge = {
  tabId: "tab-1",
  currentPlace: () => null,
  dataChanged: () => {},
  browserCall: async () => ({ error: "нет" }),
};

describe("initialDraft: текст в поле ввода при открытии чата", () => {
  it("AgentChat открывается с готовым текстом в поле", async () => {
    renderAgentChat(fakeChatServer(), { initialDraft: "Расскажи про эту карточку" });
    const field = (await screen.findByLabelText("поле")) as HTMLTextAreaElement;
    expect(field.value).toBe("Расскажи про эту карточку");
  });

  it("useAgentChat кладёт initialDraft в value", () => {
    const { result } = renderChatHook(fakeChatServer(), { initialDraft: "Привет" });
    expect(result.current.value).toBe("Привет");
  });

  it("без initialDraft поле пустое, как раньше", async () => {
    renderAgentChat(fakeChatServer());
    const field = (await screen.findByLabelText("поле")) as HTMLTextAreaElement;
    expect(field.value).toBe("");
  });
});

describe("appBridge: необязательное свойство сквозь слои", () => {
  it("AgentChat, useAgentChat и ChatWorkspace принимают мост и работают как без него", async () => {
    renderAgentChat(fakeChatServer(), { appBridge: bridge });
    expect(await screen.findByLabelText("поле")).toBeTruthy();

    const hook = renderChatHook(fakeChatServer(), { appBridge: bridge });
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  });

  it("ChatWorkspace передаёт мост открытому чату", async () => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    vi.stubGlobal("fetch", server.fetch);
    render(<ChatWorkspace api="/api/chat" skin={stubWorkspaceSkin} appBridge={bridge} />);
    expect(await screen.findByLabelText("поле")).toBeTruthy();
  });
});

describe("useChatList: rememberKey", () => {
  const api = "/api/chat";
  const threeChats = () =>
    fakeChatListServer([
      { id: "c3", title: "Третий" },
      { id: "c2", title: "Второй" },
      { id: "c1", title: "Первый" },
    ]);

  it("со своим ключом читает и пишет его, прежний ключ не трогает", async () => {
    localStorage.setItem(`agent-chat:active-chat:${api}`, "c1");
    localStorage.setItem("agent-chat:panel-chat:/api/chat:ivan", "c2");
    const server = threeChats();
    const { result } = renderHook(() => useChatList({ api, fetch: server.fetch, rememberKey: "agent-chat:panel-chat:/api/chat:ivan" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.activeChatId).toBe("c2");
    result.current.select("c3");
    await waitFor(() => expect(localStorage.getItem("agent-chat:panel-chat:/api/chat:ivan")).toBe("c3"));
    expect(localStorage.getItem(`agent-chat:active-chat:${api}`)).toBe("c1");
  });

  it("без ключа — прежний `agent-chat:active-chat:${api}`", async () => {
    localStorage.setItem(`agent-chat:active-chat:${api}`, "c1");
    localStorage.setItem("agent-chat:panel-chat:/api/chat:ivan", "c2");
    const server = threeChats();
    const { result } = renderHook(() => useChatList({ api, fetch: server.fetch }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.activeChatId).toBe("c1");
  });
});
