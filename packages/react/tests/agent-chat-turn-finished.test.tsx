// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, settle, setupChatDom } from "./support/chat-dom";

setupChatDom();

const answered: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте", state: "done" }], metadata: { status: "complete" } },
];

/** Открывает чат, отправляет вопрос и начинает ответ `a2`. */
async function startTurn() {
  const server = fakeChatServer({ history: answered });
  const onTurnFinished = vi.fn();
  renderAgentChat(server, { onTurnFinished });
  await screen.findByText("Здравствуйте");
  const stream = await sendQuestion(server, "Как дела?");
  stream.push({ type: "start", messageId: "a2", messageMetadata: { status: "streaming" } });
  stream.push({ type: "text-start", id: "t" });
  stream.push({ type: "text-delta", id: "t", delta: "Хорошо" });
  await screen.findByText("Хорошо");
  return { stream, onTurnFinished };
}

describe("AgentChat: onTurnFinished", () => {
  it("открытие чата с готовой историей событий не даёт", async () => {
    const onTurnFinished = vi.fn();
    renderAgentChat(fakeChatServer({ history: answered }), { onTurnFinished });
    await screen.findByText("Здравствуйте");
    await settle();
    expect(onTurnFinished).not.toHaveBeenCalled();
  });

  it("законченный ответ: один раз, с чатом, id ответа и итогом", async () => {
    const { stream, onTurnFinished } = await startTurn();
    expect(onTurnFinished).not.toHaveBeenCalled();
    stream.finish();
    await waitFor(() => expect(onTurnFinished).toHaveBeenCalledTimes(1));
    expect(onTurnFinished).toHaveBeenCalledWith({ chatId: "c1", messageId: "a2", status: "complete" });
    await settle();
    expect(onTurnFinished).toHaveBeenCalledTimes(1);
  });

  it("ответ с ошибкой: итог error", async () => {
    const { stream, onTurnFinished } = await startTurn();
    stream.push({ type: "text-end", id: "t" });
    stream.push({ type: "message-metadata", messageMetadata: { status: "error", error: { kind: "overloaded" } } });
    stream.push({ type: "finish" });
    stream.end();
    await waitFor(() => expect(onTurnFinished).toHaveBeenCalledTimes(1));
    expect(onTurnFinished).toHaveBeenCalledWith({ chatId: "c1", messageId: "a2", status: "error" });
  });

  it("«Стоп»: итог stopped", async () => {
    const { onTurnFinished } = await startTurn();
    fireEvent.click(document.querySelector('[data-action="stop"]')!);
    await waitFor(() => expect(onTurnFinished).toHaveBeenCalledTimes(1));
    expect(onTurnFinished).toHaveBeenCalledWith({ chatId: "c1", messageId: "a2", status: "stopped" });
  });
});
