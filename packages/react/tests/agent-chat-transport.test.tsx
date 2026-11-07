// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentChat } from "../src/agent-chat";
import { fakeChatServer } from "./support/fake-chat-server";
import { setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
setupChatDom();
describe("AgentChat custom transport", () => {
  it("uses the custom fetch for history and models without falling back to window fetch or idle watch", async () => {
    const globalFetch = vi.fn(async () => { throw Error("must not use global fetch"); }); vi.stubGlobal("fetch", globalFetch);
    const server = fakeChatServer({ history: [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "Loaded locally" }], metadata: { status: "complete" } }] });
    const fetch = vi.fn(server.fetch);
    render(<AgentChat api="/custom" chatId="c1" skin={stubSkin} transport={{ fetch, watch: false }} />);
    await screen.findByText("Loaded locally");
    await waitFor(() => expect(fetch.mock.calls.some(([input]) => String(input).endsWith("/models"))).toBe(true));
    expect(fetch.mock.calls.some(([input]) => String(input).endsWith("/watch"))).toBe(false);
    expect(globalFetch).not.toHaveBeenCalled();
  });
  it("rejects conflicting transports and server-backed extensions in browser-owned mode", () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    expect(() => render(<AgentChat api="/test" chatId="c1" skin={stubSkin} fetch={fetch} transport={{ fetch }} />)).toThrow(/fetch or transport/);
    expect(() => render(<AgentChat api="/test" subject="subject" skin={stubSkin} transport={{ fetch, kind: "browser-owned" }} />)).toThrow(/unsupported extension/);
  });
});
