// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { russianLabels } from "@ykurilov/agent-chat-react";
import { AppShellChatWorkspace, appShellChatNavigation } from "../src/chat";
import { fakeChatListServer } from "../../../packages/react/tests/support/fake-chat-list-server";
import { setupChatDom } from "../../../packages/react/tests/support/chat-dom";

setupChatDom();
beforeEach(() => { vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); localStorage.clear(); sessionStorage.clear(); vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });

describe("AppShell chat integration", () => {
  it("owns one main, puts icon-free history in the standard shell and selects through the SDK", async () => {
    vi.stubGlobal("fetch", fakeChatListServer([{ id: "c1", title: "Первый" }, { id: "c2", title: "Второй" }]).fetch);
    const change = vi.fn();
    const { container } = render(<AppShellChatWorkspace api="/api/chat" initialChatId="c1" onChatChange={change} shell={{ brand: { label: "Приложение" }, navigation: [] }} />);
    const row = await screen.findByRole("button", { name: "Второй", exact: true });
    expect(row.closest(".yk-app-shell__group")).not.toBeNull();
    expect(row.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("aside")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Новый чат", exact: true })).toBeTruthy();
    fireEvent.click(row);
    await waitFor(() => expect(change).toHaveBeenCalledWith("c2"));
    expect(screen.getByRole("button", { name: "Второй", exact: true }).getAttribute("aria-current")).toBe("page");
    expect(container.querySelector(".oduvanchik-thread-root")).not.toBeNull();
  });

  it("keeps create, rename and confirmed delete available without a second sidebar", async () => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    vi.stubGlobal("fetch", server.fetch);
    render(<AppShellChatWorkspace api="/api/chat" initialChatId="c1" shell={{ brand: { label: "Приложение" }, navigation: [] }} />);
    await screen.findByRole("button", { name: "Первый", exact: true });
    fireEvent.click(screen.getByRole("button", { name: "Новый чат", exact: true }));
    await waitFor(() => expect(server.state.created).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Чаты", exact: true }));
    expect(await screen.findByRole("dialog", { name: "Чаты" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Действия с чатом «Первый»" })).toBeTruthy();
  });
  it("keeps one main for an unavailable chat", async () => {
    vi.stubGlobal("fetch", fakeChatListServer([{ id: "c1", title: "Первый" }]).fetch);
    const { container } = render(<AppShellChatWorkspace api="/api/chat" initialChatId="missing" shell={{ brand: { label: "App" }, navigation: [] }} />);
    await screen.findByText(russianLabels.chatNotFound);
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("does not expose a prohibited chat list", async () => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    server.chatServer.state.capabilities = { chatList: false };
    vi.stubGlobal("fetch", server.fetch);
    const { container } = render(<AppShellChatWorkspace api="/api/chat" initialChatId="c1" shell={{ brand: { label: "App" }, navigation: [] }} />);
    await screen.findByRole("textbox", { name: "Сообщение" });
    expect(container.querySelectorAll(".yk-app-shell__group")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Новый чат", exact: true })).toBeNull();
    expect(screen.queryByRole("button", { name: "Чаты", exact: true })).toBeNull();
  });

});

 it("does not expose history or creation before list access is granted", () => {
   expect(appShellChatNavigation({ activeTitle: "", children: null }, russianLabels)).toEqual({ groups: [] });
 });
