// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, settle, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import type { ChatSkin } from "../src/skin-contract";
import { russianLabels } from "../src/labels";

setupChatDom();

const question = (id: string, text: string): HistoryMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
  metadata: { status: "complete" },
});

/** Ответ a2 — второй из двух вариантов ответа на «Привет». */
function twoAnswers() {
  const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a2", "Второй ответ")] });
  server.state.forks = [{ messageId: "a2", siblingIds: ["a1", "a2"] }];
  server.state.branchTo = {
    a1: { messages: [question("u1", "Привет"), answer("a1", "Первый ответ")], forks: [{ messageId: "a1", siblingIds: ["a1", "a2"] }] },
  };
  return server;
}

const switcher = () => document.querySelector<HTMLElement>('[data-kind="branch-switcher"]');
const previous = () => screen.getByLabelText(russianLabels.previousBranch) as HTMLButtonElement;
const next = () => screen.getByLabelText(russianLabels.nextBranch) as HTMLButtonElement;

describe("лента: переключатель веток", () => {
  it("у сообщения с соседями рисуется «2/2»; без развилок — переключателя нет", async () => {
    const server = twoAnswers();
    renderAgentChat(server);
    await screen.findByText("Второй ответ");
    expect(switcher()?.getAttribute("data-position")).toBe("2");
    expect(switcher()?.getAttribute("data-count")).toBe("2");
    expect(within(document.querySelector('[data-kind="agent"]')!.parentElement!).getByLabelText(russianLabels.branchPosition(2, 2))).toBeTruthy();

    const plain = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Ответ")] });
    document.body.innerHTML = "";
    renderAgentChat(plain);
    await screen.findByText("Ответ");
    expect(switcher()).toBeNull();
  });

  it("на краю нет обработчика: у «2/2» «вперёд» неактивна, «назад» работает и переключает ветку", async () => {
    const server = twoAnswers();
    renderAgentChat(server);
    await screen.findByText("Второй ответ");
    expect(next().disabled).toBe(true);
    expect(previous().disabled).toBe(false);

    fireEvent.click(previous());
    await screen.findByText("Первый ответ");
    expect(server.requestsTo("branch")[0]?.body).toEqual({ messageId: "a1" });
    expect(screen.queryByText("Второй ответ")).toBeNull();
    await waitFor(() => expect(switcher()?.getAttribute("data-position")).toBe("1"));
    expect(previous().disabled).toBe(true);
    expect(next().disabled).toBe(false);
  });

  it("переключатель бывает и у вопроса собеседника (правки)", async () => {
    const server = fakeChatServer({ history: [question("u2", "Привет по-другому"), answer("a2", "Ответ")] });
    server.state.forks = [{ messageId: "u2", siblingIds: ["u1", "u2"] }];
    renderAgentChat(server);
    await screen.findByText("Ответ");
    const userText = screen.getByText("Привет по-другому");
    expect(userText.parentElement?.querySelector('[data-kind="branch-switcher"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-kind="branch-switcher"]')).toHaveLength(1);
  });

  it("пока идёт ответ, переключатель есть, но кнопки неактивны", async () => {
    const server = twoAnswers();
    renderAgentChat(server);
    await screen.findByText("Второй ответ");
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Ещё" } });
    fireEvent.submit(screen.getByLabelText("поле").closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await settle();
    expect(previous().disabled).toBe(true);
    server.streams[0]!.end();
  });
});

describe("лента: «Переделать ответ»", () => {
  it("кнопка только у последнего ответа; нажатие шлёт /regenerate", async () => {
    const server = fakeChatServer({
      history: [question("u1", "Раз"), answer("a1", "Один"), question("u2", "Два"), answer("a2", "Два ответа")],
    });
    renderAgentChat(server);
    await screen.findByText("Два ответа");
    const buttons = screen.getAllByText(russianLabels.regenerate);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.closest("article")?.textContent).toContain("Два ответа");

    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(server.regenerations).toHaveLength(1));
    expect(server.requestsTo("regenerate")[0]?.body).toEqual({ messageId: "a2", timeZone: expect.any(String) });
    server.regenerations[0]!.end();
  });

  it.each(["interrupted", "stopped", "error"] as const)(
    "ответ %s с вызовом инструмента — рядом с «Повторить» есть «Переделать ответ», она шлёт /regenerate",
    async (status) => {
      const broken: HistoryMessage = {
        id: "a1",
        role: "assistant",
        parts: [{ type: "tool-start_quiz", toolCallId: "call_old", state: "input-available", input: { kind: "quiz" } }],
        metadata: { status },
      };
      const server = fakeChatServer({ history: [question("u1", "Давай попробуем"), broken] });
      renderAgentChat(server);
      const regenerate = await screen.findByText(russianLabels.regenerate);
      expect(screen.getByRole("button", { name: russianLabels.retry })).toBeTruthy();

      fireEvent.click(regenerate);
      await waitFor(() => expect(server.regenerations).toHaveLength(1));
      expect(server.requestsTo("regenerate")[0]?.body).toMatchObject({ messageId: "a1" });
      expect(server.requestsTo("retry")).toHaveLength(0);
      server.regenerations[0]!.end();
    },
  );

  it("оборванный ответ без инструментов — только «Повторить»: продолжать нечего, она и так пишет заново", async () => {
    const broken: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Недописано", state: "done" }], metadata: { status: "interrupted" } };
    const server = fakeChatServer({ history: [question("u1", "Привет"), broken] });
    renderAgentChat(server);
    await screen.findByRole("button", { name: russianLabels.retry });
    expect(screen.queryByText(russianLabels.regenerate)).toBeNull();
  });

  it("пока идёт ответ, кнопки нет", async () => {
    const server = twoAnswers();
    renderAgentChat(server);
    await screen.findByText("Второй ответ");
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Ещё" } });
    fireEvent.submit(screen.getByLabelText("поле").closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(screen.queryByText(russianLabels.regenerate)).toBeNull();
    server.streams[0]!.end();
  });
});

describe("лента: правка сообщения", () => {
  const chat = () => fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Здравствуйте")] });

  it("«Изменить» открывает поле с текстом вместо сообщения; «Отмена» возвращает сообщение без запросов", async () => {
    const server = chat();
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = document.querySelector('[data-kind="message-editor"]')!;
    expect((within(editor as HTMLElement).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement).value).toBe("Привет");
    expect(document.querySelector('[data-kind="user"]')).toBeNull();

    fireEvent.click(within(editor as HTMLElement).getByText(russianLabels.cancelEdit));
    expect(document.querySelector('[data-kind="message-editor"]')).toBeNull();
    expect(document.querySelector('[data-kind="user"]')?.textContent).toBe("Привет");
    expect(server.requestsTo("edit")).toHaveLength(0);
  });

  it("«Отправить» шлёт /edit с новым текстом; пустой текст отправить нельзя", async () => {
    const server = chat();
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    const field = within(editor).getByLabelText(russianLabels.editMessage);
    const save = within(editor).getByText(russianLabels.saveEdit) as HTMLButtonElement;

    fireEvent.change(field, { target: { value: "   " } });
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "Добрый день" } });
    expect(save.disabled).toBe(false);
    fireEvent.submit(editor);

    await waitFor(() => expect(server.edits).toHaveLength(1));
    expect(server.requestsTo("edit")[0]?.body).toMatchObject({ editedMessageId: "u1", message: { parts: [{ type: "text", text: "Добрый день" }] } });
    expect(document.querySelector('[data-kind="message-editor"]')).toBeNull();
    await screen.findByText("Добрый день");
    server.edits[0]!.end();
  });

  it("сервер отказал (409, ответ уже идёт): поле остаётся с исправленным текстом, ошибка понятная; повтор после отказа уходит на сервер", async () => {
    const server = chat();
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const field = () => within(document.querySelector('[data-kind="message-editor"]') as HTMLElement).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement;
    fireEvent.change(field(), { target: { value: "Добрый день" } });
    server.state.refuse.edit = { status: 409, kind: "busy" };
    fireEvent.submit(document.querySelector('[data-kind="message-editor"]')!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(russianLabels.editErrors.busy);
    expect(field().value).toBe("Добрый день");
    expect(screen.getByText("Здравствуйте")).toBeTruthy();
    expect(server.requestsTo("edit")).toHaveLength(1);

    delete server.state.refuse.edit;
    fireEvent.submit(document.querySelector('[data-kind="message-editor"]')!);
    await waitFor(() => expect(server.edits).toHaveLength(1));
    await waitFor(() => expect(document.querySelector('[data-kind="message-editor"]')).toBeNull());
    await screen.findByText("Добрый день");
    server.edits[0]!.end();
  });

  it("при отказе сервера ошибка гаснет, как только текст в поле меняется; «Отмена» возвращает исходное сообщение", async () => {
    const server = chat();
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = () => document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    fireEvent.change(within(editor()).getByLabelText(russianLabels.editMessage), { target: { value: "Иначе" } });
    server.state.refuse.edit = { status: 400, kind: "invalid" };
    fireEvent.submit(editor());
    expect((await screen.findByRole("alert")).textContent).toBe(russianLabels.editErrors.rejected);

    fireEvent.change(within(editor()).getByLabelText(russianLabels.editMessage), { target: { value: "Иначе, но лучше" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(within(editor()).getByText(russianLabels.cancelEdit));
    expect(document.querySelector('[data-kind="message-editor"]')).toBeNull();
    expect(document.querySelector('[data-kind="user"]')?.textContent).toBe("Привет");
  });

  it("правка не стартовала (в это время пошёл другой ответ): поле остаётся, ошибка «ответ ещё идёт», запроса нет", async () => {
    const server = chat();
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = () => document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    fireEvent.change(within(editor()).getByLabelText(russianLabels.editMessage), { target: { value: "Иначе" } });
    // Пока поле открыто, из строки ввода ушло другое сообщение: правка занята.
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Ещё" } });
    fireEvent.submit(screen.getByLabelText("поле").closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    fireEvent.submit(editor());
    expect((await screen.findByRole("alert")).textContent).toBe(russianLabels.editErrors.busy);
    expect((within(editor()).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement).value).toBe("Иначе");
    expect(server.requestsTo("edit")).toHaveLength(0);
    server.streams[0]!.end();
  });

  it("сервер не принял правку (400): лента как была, редактор открыт с введённым текстом, без цикла переподключения", async () => {
    const server = chat();
    server.state.refuse.edit = { status: 400, kind: "invalid" };
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    let editor = document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    fireEvent.change(within(editor).getByLabelText(russianLabels.editMessage), { target: { value: "Добрый день" } });
    fireEvent.submit(editor);

    await waitFor(() => expect(server.requestsTo("edit")).toHaveLength(1));
    await screen.findByText("Здравствуйте");
    editor = await waitFor(() => {
      const found = document.querySelector('[data-kind="message-editor"]') as HTMLElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    expect((within(editor).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement).value).toBe("Добрый день");
    expect(server.requestsTo("edit")).toHaveLength(1);

    // Отмена возвращает исходное сообщение, а не неотправленный черновик.
    fireEvent.click(within(editor).getByText(russianLabels.cancelEdit));
    expect(document.querySelector('[data-kind="user"]')?.textContent).toBe("Привет");
  });

  it("пока идёт ответ, «Изменить» не предлагается", async () => {
    const server = chat();
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Ещё" } });
    fireEvent.submit(screen.getByLabelText("поле").closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(screen.queryByText(russianLabels.editMessage)).toBeNull();
    server.streams[0]!.end();
  });

  it("сообщение с развилкой не перерисовывается, пока растёт новый ответ", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Готово")] });
    server.state.forks = [{ messageId: "u1", siblingIds: ["u0", "u1"] }];
    let renders = 0;
    const UserMessage: ChatSkin["UserMessage"] = (props) => {
      if (props.text === "Привет") renders += 1;
      return <stubSkin.UserMessage {...props} />;
    };
    renderAgentChat(server, { skin: { ...stubSkin, UserMessage } });
    await screen.findByText("Готово");
    expect(switcher()).not.toBeNull();

    const stream = await sendQuestion(server, "Ещё вопрос");
    stream.push({ type: "start", messageId: "a-new", messageMetadata: { status: "streaming" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: "Пер" });
    await screen.findByText("Пер");
    const before = renders;
    for (const delta of ["вое", " слово", " второе"]) {
      stream.push({ type: "text-delta", id: "t1", delta });
      await settle();
    }
    await screen.findByText("Первое слово второе");
    expect(renders).toBe(before);
    stream.finish("t1");
  });
});
