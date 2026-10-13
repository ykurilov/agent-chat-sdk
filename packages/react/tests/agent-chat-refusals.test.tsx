// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { russianLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import type { Endpoint, HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom, submitQuestion } from "./support/chat-dom";

setupChatDom();

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const answered: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте", state: "done" }], metadata: { status: "complete" } };

const field = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const errorNotice = () => document.querySelector('[data-kind="error-notice"]') as HTMLElement | null;
const connectionNotice = () => document.querySelector('[data-kind="connection-notice"]');
const pause = (ms = 50) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

const ALL_ENDPOINTS: Endpoint[] = ["history", "messages", "retry", "regenerate", "edit", "stream", "stop", "models", "model", "compactions", "branches", "branch", "approval", "spending"];

/** Сессия человека кончилась: сервер на всё отвечает 401. */
function signOut(server: ReturnType<typeof fakeChatServer>) {
  for (const endpoint of ALL_ENDPOINTS) server.state.refuse[endpoint] = { status: 401, kind: "invalid" };
}
function signIn(server: ReturnType<typeof fakeChatServer>) {
  server.state.refuse = {};
}

describe("AgentChat: вход истёк", () => {
  it("при открытии чата: «Вход истёк. Войдите снова», а не «Что-то пошло не так» и не «Нет связи»; попыток нет", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    signOut(server);
    renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });

    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("signed_out"));
    expect(errorNotice()!.textContent).toContain(russianLabels.errors.signed_out);
    expect(connectionNotice()).toBeNull();
    await pause();
    expect(server.requestsTo("history")).toHaveLength(1);
  });

  it("вошёл снова и нажал «Повторить»: чат загружается, надпись уходит", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    signOut(server);
    renderAgentChat(server);
    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("signed_out"));

    signIn(server);
    fireEvent.click(within(errorNotice()!).getByRole("button"));
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(errorNotice()).toBeNull());
  });

  it("при отправке: текст возвращается в поле, сообщения в ленте нет, «Войдите снова», без серии попыток", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Здравствуйте");
    const historyBefore = server.requestsTo("history").length;

    signOut(server);
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("signed_out"));
    expect(field().value).toBe("Как дела?");
    expect(screen.queryByText("Как дела?", { selector: '[data-kind="user"] *' })).toBeNull();
    expect(screen.getByText("Здравствуйте", { selector: '[data-kind="text"]' })).toBeTruthy();
    expect(connectionNotice()).toBeNull();
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(1);
    expect(server.requestsTo("history").length - historyBefore).toBeLessThanOrEqual(1);
  });
});

describe("AgentChat: у человека уже идут ответы в других чатах (429 too_many_turns)", () => {
  it("отправка: текст в поле, сообщения нет, понятная надпись, без «Нет связи» и без повторов", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Здравствуйте");

    server.state.refuse.messages = { status: 429, kind: "too_many_turns" };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("too_many_turns"));
    expect(errorNotice()!.textContent).toContain(russianLabels.errors.too_many_turns);
    expect(field().value).toBe("Как дела?");
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(1);
    expect(connectionNotice()).toBeNull();
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(1);
  });

  it("следующая отправка прошла — надпись уходит", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    server.state.refuse.messages = { status: 429, kind: "too_many_turns" };
    submitQuestion("Как дела?");
    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("too_many_turns"));

    server.state.refuse = {};
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await waitFor(() => expect(errorNotice()).toBeNull());
  });

  it("переделка ответа: прежний ответ на месте, надпись, без «Нет связи»", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Здравствуйте");

    server.state.refuse.regenerate = { status: 429, kind: "too_many_turns" };
    fireEvent.click(screen.getByText(russianLabels.regenerate));

    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("too_many_turns"));
    await waitFor(() => expect(screen.getByText("Здравствуйте", { selector: '[data-kind="text"]' })).toBeTruthy());
    await pause();
    expect(connectionNotice()).toBeNull();
    expect(server.requestsTo("regenerate")).toHaveLength(1);
  });

  it("правка: редактор остаётся открытым с текстом и своей надписью", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = () => document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    const editorField = () => within(editor()).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement;
    fireEvent.change(editorField(), { target: { value: "Добрый день" } });

    server.state.refuse.edit = { status: 429, kind: "too_many_turns" };
    fireEvent.submit(editor());

    expect((await screen.findByRole("alert")).textContent).toBe(russianLabels.editErrors.tooManyTurns);
    expect(editorField().value).toBe("Добрый день");
    expect(screen.getByText("Здравствуйте", { selector: '[data-kind="text"]' })).toBeTruthy();
  });
});

describe("AgentChat: сервер не признал страницу своей (403 forbidden_origin)", () => {
  it("отправка: текст в поле, понятная надпись, без «Нет связи» и без повторов; разработчику — подсказка про allowedOrigins", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Здравствуйте");

    server.state.refuse.messages = { status: 403, kind: "forbidden_origin" };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("forbidden_origin"));
    expect(errorNotice()!.textContent).toContain(russianLabels.errors.forbidden_origin);
    expect(field().value).toBe("Как дела?");
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(1);
    expect(connectionNotice()).toBeNull();
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/allowedOrigins/);
    warn.mockRestore();
  });

  it("следующая отправка прошла — надпись уходит", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    server.state.refuse.messages = { status: 403, kind: "forbidden_origin" };
    submitQuestion("Как дела?");
    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("forbidden_origin"));

    server.state.refuse = {};
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await waitFor(() => expect(errorNotice()).toBeNull());
    warn.mockRestore();
  });

  it("правка: редактор остаётся открытым с текстом и своей надписью", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = () => document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    const editorField = () => within(editor()).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement;
    fireEvent.change(editorField(), { target: { value: "Добрый день" } });

    server.state.refuse.edit = { status: 403, kind: "forbidden_origin" };
    fireEvent.submit(editor());

    expect((await screen.findByRole("alert")).textContent).toBe(russianLabels.editErrors.forbiddenOrigin);
    expect(editorField().value).toBe("Добрый день");
    // Одна ошибка — одно сообщение: надпись в редакторе, над полем ввода ничего.
    await pause();
    expect(errorNotice()).toBeNull();
    warn.mockRestore();
  });
});

describe("AgentChat: 403 не от чата (страница прокси с HTML) — обычный сбой, не «чужая страница»", () => {
  const proxyPage = { status: 403, kind: "", html: "<html><body>403 Forbidden</body></html>" };

  it("отправка: надписи про чужую страницу нет, подсказки в консоли нет", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Здравствуйте");

    server.state.refuse.messages = proxyPage;
    submitQuestion("Как дела?");
    await waitFor(() => expect(server.requestsTo("messages").length).toBeGreaterThan(0));
    await pause(200);
    expect(errorNotice()?.getAttribute("data-error-kind")).not.toBe("forbidden_origin");
    expect(document.body.textContent).not.toContain(russianLabels.errors.forbidden_origin);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("правка: не «чужая страница», а обычный сбой", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = () => document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    fireEvent.change(within(editor()).getByLabelText(russianLabels.editMessage), { target: { value: "Добрый день" } });

    server.state.refuse.edit = proxyPage;
    fireEvent.submit(editor());
    await waitFor(() => expect(server.requestsTo("edit").length).toBeGreaterThan(0));
    await pause(200);
    expect(document.body.textContent).not.toContain(russianLabels.editErrors.forbiddenOrigin);
    expect(document.body.textContent).not.toContain(russianLabels.errors.forbidden_origin);
  });
});
