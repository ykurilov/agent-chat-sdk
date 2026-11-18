// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentChat } from "../src/chat";
import { fakeChatServer } from "../../../packages/react/tests/support/fake-chat-server";
import { setupChatDom } from "../../../packages/react/tests/support/chat-dom";

setupChatDom();

/* Договор 34 в Одуванчике: закрытый ради поправки ответ без текста — не пустая карточка, «Стоп» до первого слова — понятная строка. */

const hidden = [{ type: "data-frozen-context", data: { blocks: [] } }, { type: "step-start" }, { type: "data-answer-reasoning", data: { level: "low" } }];

it("ответ без текста: закрытый ради поправки не виден, остановленный до начала — строкой и с «Повторить»", async () => {
  const server = fakeChatServer({
    history: [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Посмотри" }] },
      { id: "a1", role: "assistant", parts: hidden, metadata: { status: "complete" } },
      { id: "s1", role: "user", parts: [{ type: "text", text: "И ярче" }, { type: "data-agent-steer", data: true }] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Сделал ярче" }], metadata: { status: "complete" } },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Ещё раз" }] },
      { id: "a3", role: "assistant", parts: hidden, metadata: { status: "stopped" } },
    ] as never,
  });
  vi.stubGlobal("fetch", server.fetch);
  const { container } = render(<AgentChat api="/api/chat" chatId="c1" />);

  expect(await screen.findByText("Ответ остановлен до начала")).toBeTruthy();
  expect(screen.queryByText("Модель не дала ответа")).toBeNull();
  expect(screen.queryByText("Остановлено")).toBeNull();
  expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  // Карточки две: ответ на поправку и остановленный; закрытого ради поправки нет.
  expect(container.querySelectorAll(".oduvanchik-agent")).toHaveLength(2);
});
