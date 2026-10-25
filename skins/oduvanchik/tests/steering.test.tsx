// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentChat } from "../src/chat";
import { fakeChatServer } from "../../../packages/react/tests/support/fake-chat-server";
import { setupChatDom } from "../../../packages/react/tests/support/chat-dom";

setupChatDom();

it("Oduvanchik sends a correction during an active answer and clears its pending badge when applied", async () => {
  const server = fakeChatServer({ resumable: true });
  vi.stubGlobal("fetch", server.fetch);
  render(<AgentChat api="/api/chat" chatId="c1" />);
  await screen.findByRole("heading", { name: "С чего начнём?" });
  const field = screen.getByRole("textbox", { name: "Сообщение" });
  fireEvent.change(field, { target: { value: "Нарисуй кнопку" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(server.streams).toHaveLength(1));
  const stream = server.streams[0]!;
  await act(async () => {
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Рисую" });
  });
  await screen.findByText("Рисую");
  fireEvent.change(field, { target: { value: "Сделай синей" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
  expect(server.streams).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Остановить" })).toBeTruthy();
  expect(await screen.findByText("Агент учтёт на следующем шаге")).toBeTruthy();
  const correction = (server.requestsTo("steer")[0]!.body as { message: { id: string } }).message;
  server.state.history = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Нарисуй кнопку" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "Рисую" }], metadata: { status: "complete" } },
    { id: correction.id, role: "user", parts: [{ type: "text", text: "Сделай синей" }, { type: "data-agent-steer", data: true }] },
  ];
  server.state.running = true;
  await act(async () => { stream.finish("t"); });
  await waitFor(() => expect(server.resumed).toHaveLength(1));
  await act(async () => { server.resumed[0]!.answer("Готово, синяя", "a2"); });
  await within(screen.getByRole("log")).findByText("Готово, синяя");
  await waitFor(() => expect(screen.queryByText("Агент учтёт на следующем шаге")).toBeNull());
  expect(screen.getByText("Сделай синей")).toBeTruthy();
});
