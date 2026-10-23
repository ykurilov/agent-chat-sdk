// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentChat } from "../src/agent-chat";
import type { ChatSkin } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import { setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();
const skin: ChatSkin = {
  ...stubSkin,
  Layout: (props) => <div data-testid="layout" data-empty={String(props.empty === true)}><stubSkin.Layout {...props} /></div>,
};
const empty = () => screen.getByTestId("layout").getAttribute("data-empty");

describe("Layout empty state comes from the loaded feed", () => {
  it("stays false while loading, then becomes true, then false as soon as a turn starts", async () => {
    const server = fakeChatServer();
    let release!: () => void;
    server.state.gate.history = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", server.fetch);
    render(<AgentChat api="/api/chat" chatId="c1" skin={skin} />);
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(1));
    expect(empty()).toBe("false");
    await act(async () => { release(); });
    await waitFor(() => expect(empty()).toBe("true"));
    const field = screen.getByRole("textbox", { name: "поле" });
    fireEvent.change(field, { target: { value: "Вопрос" } });
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(empty()).toBe("false");
    await act(async () => { server.streams[0]!.answer("Ответ"); });
    expect(empty()).toBe("false");
  });

  it("does not call a failed history an empty chat", async () => {
    const server = fakeChatServer();
    server.state.fail.add("history");
    vi.stubGlobal("fetch", server.fetch);
    render(<AgentChat api="/api/chat" chatId="c1" skin={skin} />);
    await screen.findByTestId("notice");
    expect(empty()).toBe("false");
  });

  it("does not show a greeting for an in-progress turn with an empty history", async () => {
    const server = fakeChatServer({ running: true, resumable: true });
    vi.stubGlobal("fetch", server.fetch);
    render(<AgentChat api="/api/chat" chatId="c1" skin={skin} />);
    await waitFor(() => expect(server.requestsTo("stream")).toHaveLength(1));
    expect(empty()).toBe("false");
  });

  it("does not replace an approval-only response with a greeting", async () => {
    const server = fakeChatServer({ history: [{ id: "a1", role: "assistant", parts: [{ type: "tool-confirm", toolCallId: "t1", state: "approval-requested", input: {}, approval: { id: "ap1" } }], metadata: { status: "awaiting_approval" } }] });
    vi.stubGlobal("fetch", server.fetch);
    render(<AgentChat api="/api/chat" chatId="c1" skin={skin} />);
    await waitFor(() => expect(server.requestsTo("models")).toHaveLength(1));
    expect(empty()).toBe("false");
  });
});
