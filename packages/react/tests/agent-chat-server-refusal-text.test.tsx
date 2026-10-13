// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { russianLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom, submitQuestion } from "./support/chat-dom";

setupChatDom();

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const answered: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте", state: "done" }], metadata: { status: "complete" } };

const field = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const errorNotice = () => document.querySelector('[data-kind="error-notice"]') as HTMLElement | null;
const pause = (ms = 50) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

async function openChat(server: ReturnType<typeof fakeChatServer>) {
  renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });
  await screen.findByText("Здравствуйте");
}

describe("AgentChat: сервер отказал отправке 4xx с понятным текстом", () => {
  it("409 { error: «Разговор завершён» }: виден текст сервера, «Повторить» нет, текст вернулся в поле, повторов нет", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.messages = { status: 409, kind: "", body: { error: "Разговор завершён" } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Разговор завершён"));
    expect(errorNotice()!.textContent).not.toContain(russianLabels.errors.other);
    expect(within(errorNotice()!).queryByRole("button")).toBeNull();
    expect(field().value).toBe("Как дела?");
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(1);
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(1);
  });

  it("текст из { error: { kind, message } } тоже показывается", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.messages = { status: 422, kind: "", body: { error: { kind: "closed", message: "Анкета уже отправлена" } } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Анкета уже отправлена"));
    expect(within(errorNotice()!).queryByRole("button")).toBeNull();
  });

  it("разметка в тексте — просто текст, длинный текст обрезан", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    const long = `<b>Жирно</b> ${"очень длинная причина ".repeat(40)}`;
    server.state.refuse.messages = { status: 403, kind: "", body: { error: long } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain("<b>Жирно</b>"));
    expect(errorNotice()!.querySelector("b")).toBeNull();
    const shown = errorNotice()!.textContent!;
    expect(shown.length).toBeLessThanOrEqual(300);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("следующая отправка прошла — надпись уходит", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);
    server.state.refuse.messages = { status: 409, kind: "", body: { error: "Разговор завершён" } };
    submitQuestion("Как дела?");
    await waitFor(() => expect(errorNotice()?.textContent).toContain("Разговор завершён"));

    server.state.refuse = {};
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await waitFor(() => expect(errorNotice()).toBeNull());
  });

  it("429 с текстом, но не лимит: текст виден, «Повторить» остаётся — подождать и повторить имеет смысл", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.messages = { status: 429, kind: "", body: { error: "Подождите минуту" } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Подождите минуту"));
    expect(within(errorNotice()!).getByRole("button", { name: russianLabels.retry })).toBeTruthy();
  });
});

describe("AgentChat: отказы без текста и сбои сервера — как раньше", () => {
  it("4xx без текста: общий текст", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.messages = { status: 422, kind: "", body: {} };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain(russianLabels.errors.other));
  });

  it("409 busy самого SDK: общий текст и «Повторить»", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.messages = { status: 409, kind: "busy" };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain(russianLabels.errors.other));
    expect(within(errorNotice()!).getByRole("button", { name: russianLabels.retry })).toBeTruthy();
  });

  it("500 с текстом: общий текст и «Повторить»", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.messages = { status: 500, kind: "", body: { error: "Внутренняя ошибка базы" } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain(russianLabels.errors.other));
    expect(document.body.textContent).not.toContain("Внутренняя ошибка базы");
    expect(within(errorNotice()!).getByRole("button", { name: russianLabels.retry })).toBeTruthy();
  });
});

describe("AgentChat: текст отказа у переделки и правки", () => {
  it("«Переделать» получил 409 с текстом: прежний ответ на месте, текст сервера, «Повторить» нет", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.regenerate = { status: 409, kind: "", body: { error: "Разговор завершён" } };
    fireEvent.click(screen.getByText(russianLabels.regenerate));

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Разговор завершён"));
    expect(within(errorNotice()!).queryByRole("button")).toBeNull();
    await waitFor(() => expect(screen.getByText("Здравствуйте", { selector: '[data-kind="text"]' })).toBeTruthy());
    await pause();
    expect(server.requestsTo("regenerate")).toHaveLength(1);
  });

  it("правка получила 409 с текстом: редактор открыт с текстом и надписью сервера, а не «ответ ещё идёт»", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = () => document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    const editorField = () => within(editor()).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement;
    fireEvent.change(editorField(), { target: { value: "Добрый день" } });

    server.state.refuse.edit = { status: 409, kind: "", body: { error: "Разговор завершён" } };
    fireEvent.submit(editor());

    expect((await screen.findByRole("alert")).textContent).toBe("Разговор завершён");
    expect(editorField().value).toBe("Добрый день");
    await pause();
    expect(errorNotice()).toBeNull();
  });
});
