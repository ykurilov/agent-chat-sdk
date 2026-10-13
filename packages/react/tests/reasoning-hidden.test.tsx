// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";

setupChatDom();

const encrypted = { openrouter: { reasoning_details: [{ type: "reasoning.encrypted", data: "секретный-шифр" }] } };

function answerWith(reasoningText: string): HistoryMessage[] {
  return [
    { id: "u1", role: "user", parts: [{ type: "text", text: "вопрос" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: reasoningText, state: "done", providerMetadata: encrypted },
        { type: "text", text: "ответ", state: "done" },
      ],
      metadata: { status: "complete", modelId: "gpt-6-luna", providerId: "openrouter" },
    },
  ];
}

describe("зашифрованные рассуждения", () => {
  it("часть без пересказа, только с шифром, не рисуется блоком, шифр на экран не попадает", async () => {
    renderAgentChat(fakeChatServer({ history: answerWith("") }));
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("ответ"));
    expect(document.querySelector('[data-kind="reasoning"]')).toBeNull();
    expect(document.body.textContent).not.toContain("секретный-шифр");
  });

  it("с пересказом рисуется блок только с текстом пересказа", async () => {
    renderAgentChat(fakeChatServer({ history: answerWith("Считаю пары") }));
    await waitFor(() => expect(document.querySelector('[data-kind="reasoning"]')).not.toBeNull());
    expect(document.querySelector('[data-kind="reasoning"]')?.textContent).toBe("Считаю пары");
    expect(document.body.textContent).not.toContain("секретный-шифр");
  });
});
