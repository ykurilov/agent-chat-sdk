// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, settle, setupChatDom } from "./support/chat-dom";
import { russianLabels } from "../src/labels";

// Набранный в поле правки текст переживает всё, что перерисовывает ленту: окно ленты, перечитывание истории, переход
// ветки, новый id сообщения. Сообщение пропало на сервере — текст уходит в поле ввода, а не исчезает.

setupChatDom();

const question = (id: string, text: string): HistoryMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
  metadata: { status: "complete" },
});

const editor = () => document.querySelector<HTMLElement>('[data-kind="message-editor"]');
const editorField = () => within(editor()!).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement;
const composer = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const scroller = () => document.querySelector<HTMLElement>('[data-testid="scroller"]')!;

/**
 * Прокручивает ленту, пока не покажется `text`. Окно ленты само доводит прокрутку к последнему сообщению, пока идут
 * замеры, и на медленной машине перебивает прокрутку теста — поэтому прокрутка повторяется до нужного вида.
 */
async function scrollFeedUntilShown(to: "top" | "bottom", text: string) {
  await waitFor(() => {
    scroller().scrollTop = to === "top" ? 0 : scroller().scrollHeight;
    expect(screen.getByText(text)).toBeTruthy();
  });
  await settle();
}

/** Открывает правку первого показанного сообщения человека и набирает текст. */
async function typeIntoEditor(text: string) {
  fireEvent.click(screen.getAllByText(russianLabels.editMessage)[0]!);
  await waitFor(() => expect(editor()).not.toBeNull());
  fireEvent.change(editorField(), { target: { value: text } });
  expect(editorField().value).toBe(text);
}

describe("AgentChat: черновик правки", () => {
  it("поле правки ушло из окна ленты (прокрутка к ответу) и вернулось — набранный текст на месте", async () => {
    const history = Array.from({ length: 40 }, (_, index) => [question(`u${index}`, `Вопрос ${index}`), answer(`a${index}`, `Ответ ${index}`)]).flat();
    renderAgentChat(fakeChatServer({ history }));
    await screen.findByText("Ответ 39");
    await scrollFeedUntilShown("top", "Вопрос 0");

    await typeIntoEditor("Новый вопрос");
    await scrollFeedUntilShown("bottom", "Ответ 39");
    expect(screen.queryByText("Ответ 0")).toBeNull();
    await scrollFeedUntilShown("top", "Ответ 0");

    expect(editor()).not.toBeNull();
    expect(editorField().value).toBe("Новый вопрос");
  });

  it("переход на другую ветку ответа ниже не сбрасывает набранный текст", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a2", "Второй ответ")] });
    server.state.forks = [{ messageId: "a2", siblingIds: ["a1", "a2"] }];
    server.state.branchTo = {
      a1: { messages: [question("u1", "Привет"), answer("a1", "Первый ответ")], forks: [{ messageId: "a1", siblingIds: ["a1", "a2"] }] },
    };
    renderAgentChat(server);
    await screen.findByText("Второй ответ");

    await typeIntoEditor("Добрый день");
    fireEvent.click(screen.getByLabelText(russianLabels.previousBranch));
    await screen.findByText("Первый ответ");
    await settle();

    expect(editorField().value).toBe("Добрый день");
  });

  it("перечитанная история дала сообщению новый id — поле правки открыто с набранным текстом, сохраняется по новому id", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Здравствуйте")] });
    server.state.watch = true;
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(server.watches).toHaveLength(1));

    await typeIntoEditor("Добрый день");
    server.state.history = [question("u1-stored", "Привет"), answer("a1-stored", "Здравствуйте")];
    act(() => server.emit({ type: "message-added" }));
    await waitFor(() => expect(server.requestsTo("history").length).toBeGreaterThan(1));
    await settle();

    expect(editor()).not.toBeNull();
    expect(editorField().value).toBe("Добрый день");
    fireEvent.submit(editor()!);
    await waitFor(() => expect(server.edits).toHaveLength(1));
    expect(server.requestsTo("edit")[0]?.body).toMatchObject({ editedMessageId: "u1-stored", message: { parts: [{ type: "text", text: "Добрый день" }] } });
    server.edits[0]!.end();
  });

  it("сообщение пропало на сервере — поле правки закрыто, набранный текст ушёл в поле ввода", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Здравствуйте")] });
    server.state.watch = true;
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(server.watches).toHaveLength(1));

    await typeIntoEditor("Добрый день");
    server.state.history = [question("u9", "Совсем другое"), answer("a9", "Другой ответ")];
    act(() => server.emit({ type: "message-added" }));
    await screen.findByText("Другой ответ");
    await settle();

    expect(editor()).toBeNull();
    expect(composer().value).toBe("Добрый день");
  });

  it("правка сразу после конца ответа: история, перечитанная после хода позже, не трогает набранный текст", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Здравствуйте")] });
    server.state.watch = true;
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    const stream = await sendQuestion(server, "Как дела?");
    const sent = (server.requestsTo("messages")[0]!.body as { message: { id: string } }).message.id;
    server.state.history = [question("u1", "Привет"), answer("a1", "Здравствуйте"), question(sent, "Как дела?"), answer("a2", "Хорошо")];
    // Сервер без прогрева: история после хода приходит, когда человек уже правит.
    let release = () => {};
    server.state.gate.history = new Promise<void>((resolve) => (release = resolve));
    stream.answer("Хорошо", "a2");

    // Кнопка правки появляется в конце хода — человек жмёт её сразу.
    await waitFor(() => fireEvent.click(screen.getAllByText(russianLabels.editMessage)[1]!));
    await waitFor(() => expect(editor()).not.toBeNull());
    fireEvent.change(editorField(), { target: { value: "Как настроение?" } });
    const reads = server.requestsTo("history").length;
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    act(() => release());
    await settle();
    await settle();

    expect(editorField().value).toBe("Как настроение?");
  });
});
