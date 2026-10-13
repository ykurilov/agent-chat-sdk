// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { panelChatKey, panelOpenKey, readPanelOpen, rememberPanelOpen, usePanelOpen } from "../../src/agent-panel/panel-state";
import { useChatList } from "../../src/chat-list/use-chat-list";
import { fakeChatListServer } from "../support/fake-chat-list-server";

const api = "/api/chat";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("panel-state: открыта ли панель — на api + человека", () => {
  it("ключи — по договору data-model", () => {
    expect(panelOpenKey(api, "ivan")).toBe("agent-chat:panel:/api/chat:ivan");
    expect(panelChatKey(api, "ivan")).toBe("agent-chat:panel-chat:/api/chat:ivan");
  });

  it("запоминает и читает своё значение; другой человек и другой api — свои", () => {
    rememberPanelOpen(api, "ivan", true);
    expect(localStorage.getItem("agent-chat:panel:/api/chat:ivan")).toBe('{"open":true}');
    expect(readPanelOpen(api, "ivan")).toBe(true);
    expect(readPanelOpen(api, "maria")).toBe(false);
    expect(readPanelOpen("/api/other", "ivan")).toBe(false);
    rememberPanelOpen(api, "ivan", false);
    expect(readPanelOpen(api, "ivan")).toBe(false);
  });

  it.each(["{", "true", '{"open":"yes"}', "null", "[]", '{"closed":true}'])("битое значение %s — закрыта", (stored) => {
    localStorage.setItem(panelOpenKey(api, "ivan"), stored);
    expect(readPanelOpen(api, "ivan")).toBe(false);
  });

  it("хранилище недоступно — закрыта, запись без ошибки, состояние держится в памяти", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readPanelOpen(api, "denied")).toBe(false);
    expect(() => rememberPanelOpen(api, "denied", false)).not.toThrow();
    const { result } = renderHook(() => usePanelOpen(api, "denied"));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it("хранилище переполнено — запись не прошла, панель всё равно переключается", () => {
    rememberPanelOpen(api, "full", true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { result } = renderHook(() => usePanelOpen(api, "full"));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });

  it("usePanelOpen: смена человека — его состояние; запись идёт под текущего", () => {
    rememberPanelOpen(api, "ivan", true);
    const { result, rerender } = renderHook(({ userKey }) => usePanelOpen(api, userKey), { initialProps: { userKey: "ivan" } });
    expect(result.current[0]).toBe(true);
    rerender({ userKey: "maria" });
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(readPanelOpen(api, "maria")).toBe(true);
    act(() => result.current[1](false));
    expect(readPanelOpen(api, "maria")).toBe(false);
    expect(readPanelOpen(api, "ivan")).toBe(true);
  });
});

describe("useChatList: смена ключа запоминания — список другого человека", () => {
  const threeChats = () =>
    fakeChatListServer([
      { id: "c3", title: "Третий" },
      { id: "c2", title: "Второй" },
      { id: "c1", title: "Первый" },
    ]);

  it("открывается запомненный чат нового человека, а не чат прошлого", async () => {
    localStorage.setItem(panelChatKey(api, "ivan"), "c2");
    localStorage.setItem(panelChatKey(api, "maria"), "c1");
    const server = threeChats();
    const { result, rerender } = renderHook(({ userKey }) => useChatList({ api, fetch: server.fetch, rememberKey: panelChatKey(api, userKey) }), {
      initialProps: { userKey: "ivan" },
    });
    await waitFor(() => expect(result.current.activeChatId).toBe("c2"));
    rerender({ userKey: "maria" });
    await waitFor(() => expect(result.current.activeChatId).toBe("c1"));
    expect(localStorage.getItem(panelChatKey(api, "ivan"))).toBe("c2");
  });

  it("у нового человека ничего не запомнено — самый недавний чат, запомненный чат прошлого не переносится", async () => {
    localStorage.setItem(panelChatKey(api, "ivan"), "c1");
    const server = threeChats();
    const { result, rerender } = renderHook(({ userKey }) => useChatList({ api, fetch: server.fetch, rememberKey: panelChatKey(api, userKey) }), {
      initialProps: { userKey: "ivan" },
    });
    await waitFor(() => expect(result.current.activeChatId).toBe("c1"));
    rerender({ userKey: "maria" });
    expect(result.current.activeChatId).toBeNull();
    await waitFor(() => expect(result.current.activeChatId).toBe("c3"));
    expect(localStorage.getItem(panelChatKey(api, "maria"))).toBe("c3");
  });
});
