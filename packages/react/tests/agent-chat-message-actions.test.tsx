// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import type { MessageAction } from "../src/message-actions";
import type { ChatSkin } from "../src/skin-contract";

setupChatDom();

const question = (id: string, text: string): HistoryMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string, status = "complete"): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
  metadata: { status },
});
const twoAnswers = [question("u1", "Привет"), answer("a1", "Первый"), question("u2", "Ещё"), answer("a2", "Второй")];

/** Заглушка скина, которая рисует свои кнопки ответа: подпись, иконку и «занято». */
const skin: ChatSkin = {
  ...stubSkin,
  AgentMessage: ({ children, status, actions }) => (
    <article data-kind="agent" data-status={status}>
      {children}
      {actions?.map((action) => (
        <button key={action.id} type="button" data-action={action.id} aria-busy={action.busy} disabled={action.busy} onClick={action.onRun}>
          {action.icon}
          {action.label}
        </button>
      ))}
    </article>
  ),
};

const likeButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-action="like"]')];
const like = (overrides: Partial<MessageAction> = {}): MessageAction => ({ id: "like", label: "Нравится", onRun: vi.fn(), ...overrides });

describe("лента: свои кнопки под ответом агента", () => {
  it("без messageActions скин кнопок не получает", async () => {
    renderAgentChat(fakeChatServer({ history: twoAnswers }), { skin });
    await screen.findByText("Второй");
    expect(likeButtons()).toHaveLength(0);
  });

  it("кнопка есть под каждым законченным ответом, с подписью и иконкой приложения; у сообщений человека её нет", async () => {
    renderAgentChat(fakeChatServer({ history: twoAnswers }), { skin, messageActions: [like({ icon: <i data-icon="heart" /> })] });
    await screen.findByText("Второй");
    expect(likeButtons()).toHaveLength(2);
    expect(likeButtons()[0]!.textContent).toBe("Нравится");
    expect(likeButtons()[0]!.querySelector('[data-icon="heart"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-kind="user"] [data-action="like"]')).toHaveLength(0);
  });

  it("нажатие зовёт обработчик с чатом, id ответа, сообщением и его текстом", async () => {
    const onRun = vi.fn();
    renderAgentChat(fakeChatServer({ history: twoAnswers }), { skin, messageActions: [like({ onRun })] });
    await screen.findByText("Второй");
    fireEvent.click(likeButtons()[0]!);
    expect(onRun).toHaveBeenCalledTimes(1);
    const context = onRun.mock.calls[0]![0];
    expect(context).toMatchObject({ chatId: "c1", messageId: "a1", text: "Первый" });
    expect(context.message.id).toBe("a1");
  });

  it("visible решает по ответу: статус и последний ли", async () => {
    const visible = vi.fn(({ last }: { last: boolean }) => last);
    renderAgentChat(fakeChatServer({ history: twoAnswers }), { skin, messageActions: [like({ visible })] });
    await screen.findByText("Второй");
    await waitFor(() => expect(likeButtons()).toHaveLength(1));
    expect(likeButtons()[0]!.closest("article")!.textContent).toContain("Второй");
    expect(visible).toHaveBeenCalledWith(expect.objectContaining({ status: "complete", last: false, message: expect.objectContaining({ id: "a1" }) }));
  });

  it("пока ответ пишется, у него кнопок нет; у прежних ответов остаются", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Первый")] });
    renderAgentChat(server, { skin, messageActions: [like()] });
    await screen.findByText("Первый");
    const stream = await sendQuestion(server, "Ещё");
    stream.push({ type: "start", messageId: "a2", messageMetadata: { status: "streaming" } });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Пишу" });
    await screen.findByText("Пишу");
    expect(likeButtons()).toHaveLength(1);
    expect(likeButtons()[0]!.closest("article")!.textContent).toContain("Первый");
    stream.finish();
    await waitFor(() => expect(likeButtons()).toHaveLength(2));
  });

  it("пока обещание обработчика не выполнено, кнопка «занята» — только у этого ответа", async () => {
    let done!: () => void;
    const onRun = vi.fn(() => new Promise<void>((resolve) => (done = resolve)));
    renderAgentChat(fakeChatServer({ history: twoAnswers }), { skin, messageActions: [like({ onRun })] });
    await screen.findByText("Второй");
    fireEvent.click(likeButtons()[1]!);
    await waitFor(() => expect(likeButtons()[1]!.getAttribute("aria-busy")).toBe("true"));
    expect(likeButtons()[0]!.getAttribute("aria-busy")).toBe("false");
    fireEvent.click(likeButtons()[1]!);
    expect(onRun).toHaveBeenCalledTimes(1);
    await act(async () => done());
    await waitFor(() => expect(likeButtons()[1]!.getAttribute("aria-busy")).toBe("false"));
  });

  it("ошибка обработчика не попадает в чат: кнопка снова свободна, сбой — в консоль", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRun = vi.fn(() => Promise.reject(new Error("сервер приложения упал")));
    renderAgentChat(fakeChatServer({ history: twoAnswers }), { skin, messageActions: [like({ onRun })] });
    await screen.findByText("Второй");
    fireEvent.click(likeButtons()[0]!);
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    await waitFor(() => expect(likeButtons()[0]!.getAttribute("aria-busy")).toBe("false"));
    expect(document.querySelector('[data-kind="error-notice"]')).toBeNull();
    expect(screen.getByText("Первый")).toBeTruthy();
    consoleError.mockRestore();
  });
});
