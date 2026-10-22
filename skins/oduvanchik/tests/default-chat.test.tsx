// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanelProvider } from "@ykurilov/agent-chat-react/panel";
import { tandemSkin } from "../../tandem/src/index";
import { AgentChat, AgentPanel, ChatWorkspace } from "../src/chat";
import { fakeChatServer } from "../../../packages/react/tests/support/fake-chat-server";
import { fakeChatListServer } from "../../../packages/react/tests/support/fake-chat-list-server";
import { setupChatDom } from "../../../packages/react/tests/support/chat-dom";
import { stubWorkspaceSkin } from "../../../packages/react/tests/support/stub-chat-list-skin";
import { stubPanelSkin } from "../../../packages/react/tests/support/stub-agent-panel-skin";

setupChatDom();
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => vi.restoreAllMocks());

describe("standard UI entry", () => {
  it("uses Oduvanchik without skin and sends through the real SDK", async () => {
    const server = fakeChatServer();
    vi.stubGlobal("fetch", server.fetch);
    const { container } = render(<AgentChat api="/api/chat" chatId="c1" composerOptions={{ variant: "compact" }} />);
    const field = await screen.findByRole("textbox", { name: "Сообщение" });
    expect(container.querySelector(".oduvanchik-chat")).not.toBeNull();
    expect(container.querySelector('[data-composer-variant="compact"]')).not.toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(server.streams).toHaveLength(0);
    fireEvent.change(field, { target: { value: "Привет" } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(server.streams).toHaveLength(0);
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await act(async () => { server.streams[0]!.answer("Ответ"); });
    await within(screen.getByRole("log")).findByText("Ответ");
  });

  it("forwards stop through the SDK while a default answer is streaming", async () => {
    const server = fakeChatServer();
    vi.stubGlobal("fetch", server.fetch);
    render(<AgentChat api="/api/chat" chatId="c1" />);
    const field = await screen.findByRole("textbox", { name: "Сообщение" });
    fireEvent.change(field, { target: { value: "Вопрос" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await act(async () => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push({ type: "text-start", id: "t" });
      server.streams[0]!.push({ type: "text-delta", id: "t", delta: "Начало" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Остановить" }));
    await waitFor(() => expect(server.requests.some((request) => request.url.endsWith("/stop"))).toBe(true));
    await act(async () => server.streams[0]!.finish());
  });

  it("keeps explicitly selected Tandem", async () => {
    vi.stubGlobal("fetch", fakeChatServer().fetch);
    const { container } = render(<AgentChat api="/api/chat" chatId="c1" skin={tandemSkin} />);
    await screen.findByRole("textbox", { name: "Сообщение" });
    expect(container.querySelector(".oduvanchik-chat")).toBeNull();
  });

  it.each([false, true])("workspace preserves selection callbacks, custom skin=%s", async (custom) => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }, { id: "c2", title: "Второй" }]);
    vi.stubGlobal("fetch", server.fetch);
    const changed = vi.fn();
    const { container } = render(<ChatWorkspace api="/api/chat" initialChatId="c1" onChatChange={changed} {...(custom ? { skin: stubWorkspaceSkin } : {})} />);
    fireEvent.click(await screen.findByRole("button", { name: "Второй", exact: true }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith("c2"));
    expect(Boolean(container.querySelector(".oduvanchik-chat"))).toBe(!custom);
  });

  it.each([false, true])("panel preserves launcher toggle and ref focus, custom skin=%s", async (custom) => {
    vi.stubGlobal("fetch", fakeChatListServer([{ id: "c1", title: "Первый" }]).fetch);
    render(<AgentPanelProvider api="/api/chat" userKey="default-test"><AgentPanel {...(custom ? { skin: stubPanelSkin } : {})} /></AgentPanelProvider>);
    const launcher = custom ? screen.getByTestId("launcher") : screen.getByRole("button", { name: "Открыть агента" });
    await screen.findByRole("textbox", { name: custom ? "поле" : "Сообщение", hidden: true });
    fireEvent.click(launcher);
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(launcher);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });
});
