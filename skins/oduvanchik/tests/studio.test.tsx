// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ChatLabelsProvider, englishLabels } from "@ykurilov/agent-chat-react";
import { AgentChat } from "../src/chat";
import { AgentSandbox, oduvanchikSandboxSkin } from "../src/sandbox";
import { fakeSandboxServer } from "../../../packages/sandbox/tests/react/support/fake-sandbox-server";
import { stubSandboxChatSkin, stubSandboxSkin } from "../../../packages/sandbox/tests/react/support/stub-sandbox-skin";
import { stubChatListSkin } from "../../../packages/react/tests/support/stub-chat-list-skin";
import { fakeChatServer } from "../../../packages/react/tests/support/fake-chat-server";
import { setupChatDom } from "../../../packages/react/tests/support/chat-dom";

setupChatDom();
beforeEach(() => { localStorage.clear(); vi.stubGlobal("matchMedia", vi.fn().mockImplementation((media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => vi.restoreAllMocks());

describe("Oduvanchik Studio", () => {
  it("renders a loaded empty chat greeting with RU/EN and forwards the single scroll DOM ref", async () => {
    const server = fakeChatServer();
    vi.stubGlobal("fetch", server.fetch);
    const { container } = render(<ChatLabelsProvider labels={englishLabels}><AgentChat api="/api/chat" chatId="c1" /></ChatLabelsProvider>);
    await screen.findByRole("heading", { name: "Where shall we start?" });
    expect(container.querySelectorAll(".yk-scroll-area")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: englishLabels.composerLabel }), { target: { value: "Question" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(screen.queryByRole("heading", { name: "Where shall we start?" })).toBeNull();
    await act(async () => { server.streams[0]!.answer("Answer"); });
    await within(screen.getByRole("log")).findByText("Answer");
    expect(container.querySelectorAll(".oduvanchik-thread-scroll")).toHaveLength(1);
  });

  it("defaults the real sandbox to Studio and preserves instruction editing and send", async () => {
    const server = fakeSandboxServer();
    vi.stubGlobal("fetch", server.fetch);
    const { container } = render(<AgentSandbox />);
    await screen.findByRole("heading", { name: "С чего начнём?" });
    expect(container.querySelectorAll(".yk-studio")).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "Инструкция чата" }));
    const dialog = screen.getByRole("dialog", { name: "Инструкция чата" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Текст инструкции" }), { target: { value: "Новая инструкция" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(server.state.settings.instructions).toBe("Новая инструкция"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    const field = screen.getByRole("textbox", { name: "Сообщение" });
    fireEvent.change(field, { target: { value: "Вопрос" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(server.chatServer.chatServer.streams).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Остановить" })).toBeTruthy());
    await act(async () => { server.chatServer.chatServer.streams[0]!.answer("Ответ" ); });
    await within(screen.getByRole("log")).findByText("Ответ");
  });

  it("honours every explicit skin override", async () => {
    const server = fakeSandboxServer();
    vi.stubGlobal("fetch", server.fetch);
    const { container } = render(<AgentSandbox skin={stubSandboxChatSkin} sandboxSkin={stubSandboxSkin} chatListSkin={stubChatListSkin} />);
    await screen.findByRole("textbox", { name: "поле" });
    expect(container.querySelector(".yk-studio")).toBeNull();
    expect(screen.getByTestId("sandbox")).toBeTruthy();
  });

  it("journal expands real parameters and retries failed loading without manufacturing rows", () => {
    const change = vi.fn(); const retry = vi.fn();
    const { JournalList, ToolCallDetails } = oduvanchikSandboxSkin;
    const row = { kind: "tool" as const, id: "t1", toolName: "save_section", source: "server" as const, status: "complete" as const, time: "12:00", durationMs: 20, outputEdited: true, open: false, onOpenChange: change, details: <ToolCallDetails state="ready" input='{"section":"summary"}' output='{"saved":true}' error={null} truncated={false} /> };
    const props = { state: "ready" as const, rows: [row], turns: [], currentTurnId: null, onTurnChange: vi.fn() };
    const { rerender, container } = render(<JournalList {...props} busy />);
    expect(container.querySelectorAll("[data-journal-kind]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /save_section/ }));
    expect(change).toHaveBeenCalledWith(true);
    rerender(<JournalList {...props} rows={[{ ...row, open: true }]} />);
    expect(screen.getByText('{"saved":true}')).toBeTruthy();
    rerender(<JournalList {...props} state="failed" rows={[]} onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
