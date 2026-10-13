// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, settle, setupChatDom } from "./support/chat-dom";

setupChatDom();

const history: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "сказано голосом" }, { type: "data-voice-mode", data: true }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "ответ", state: "done" }], metadata: { status: "complete" } },
];

describe("AgentChat: отметка голосового сообщения", () => {
  it("сообщение человека с отметкой показывает только его слова: отметка не рисуется текстом", async () => {
    const view = renderAgentChat(fakeChatServer({ history }));
    await waitFor(() => expect(document.querySelector('[data-kind="agent"]')).not.toBeNull());
    await settle();

    const html = view.container.innerHTML;
    expect(html).toContain("сказано голосом");
    expect(html).not.toContain("data-voice-mode");
    expect(view.container.textContent).not.toMatch(/voice-mode|true/);
  });
});
