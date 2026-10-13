// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { russianLabels } from "../src/labels";
import type { ChatLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, setupChatDom, submitQuestion } from "./support/chat-dom";

setupChatDom();

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };

function answer(id: string, text: string, metadata: Record<string, unknown>): HistoryMessage {
  return { id, role: "assistant", parts: text ? [{ type: "text", text, state: "done" }] : [], metadata };
}

/** Паузы между попытками переподключения короткие: тесты проверяют вид, а не время (время — в тестах liveness). */
const quickAttempts = { reconnectDelaysMs: [0, 0, 0] } as const;

const renderChat = (server: ReturnType<typeof fakeChatServer>, labels?: ChatLabels) =>
  renderAgentChat(server, { ...(labels && { labels }), liveness: quickAttempts });

const agentMessages = () => [...document.querySelectorAll('[data-kind="agent"]')] as HTMLElement[];
const userMessages = () => [...document.querySelectorAll('[data-kind="user"]')];

/** Сервер отдаёт новый ответ на «повторить». */
const answerRetry = (server: ReturnType<typeof fakeChatServer>, text: string) => server.retries.at(-1)!.answer(text, "a2");

describe("AgentChat: ошибки и «повторить»", () => {
  it("ответ с ошибкой рисует ErrorNotice с видом ошибки; «повторить» шлёт POST retry и показывает новый ответ", async () => {
    const server = fakeChatServer({
      history: [question, answer("a1", "Начало", { status: "error", error: { kind: "overloaded" } })],
    });
    renderChat(server);

    const notice = await screen.findByText("Модель перегружена, попробуйте ещё раз");
    const errorNotice = notice.closest('[data-kind="error-notice"]') as HTMLElement;
    expect(errorNotice.getAttribute("data-error-kind")).toBe("overloaded");
    // Ошибка привязана к своему ответу, написанная часть видна.
    expect(agentMessages()[0]?.contains(errorNotice)).toBe(true);
    expect(agentMessages()[0]?.getAttribute("data-status")).toBe("error");
    expect(within(agentMessages()[0]!).getByText("Начало")).toBeTruthy();
    // У ответа с ошибкой одна кнопка «повторить» — в блоке ошибки.
    expect(screen.getAllByRole("button", { name: "Повторить" })).toHaveLength(1);

    fireEvent.click(within(errorNotice).getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(server.requestsTo("retry")).toHaveLength(1));
    expect(server.requestsTo("retry")[0]?.body ?? {}).toEqual({ timeZone: expect.any(String) });
    answerRetry(server, "Новый ответ");

    await waitFor(() => expect(screen.getByText("Новый ответ")).toBeTruthy());
    expect(agentMessages()).toHaveLength(1);
    expect(agentMessages()[0]?.getAttribute("data-status")).toBe("complete");
    expect(userMessages()).toHaveLength(1);
    expect(screen.queryByText("Модель перегружена, попробуйте ещё раз")).toBeNull();
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    // Сообщение собеседника не отправлялось заново.
    expect(server.requestsTo("messages")).toHaveLength(0);
  });

  it("надпись ошибки и кнопки берётся из словаря", async () => {
    const server = fakeChatServer({
      history: [question, answer("a1", "", { status: "error", error: { kind: "insufficient_funds" } })],
    });
    renderChat(server, {
      ...russianLabels,
      retry: "Ещё раз",
      errors: { ...russianLabels.errors, insufficient_funds: "Пополните счёт" },
    });
    expect(await screen.findByText("Пополните счёт")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ещё раз" })).toBeTruthy();
  });

  it("ответ с ошибкой без вида — other", async () => {
    const server = fakeChatServer({ history: [question, answer("a1", "", { status: "error" })] });
    renderChat(server);
    expect(await screen.findByText(russianLabels.errors.other)).toBeTruthy();
  });

  it.each([
    ["stopped", answer("a1", "Недописано", { status: "stopped" })],
    ["interrupted", answer("a1", "Недописано", { status: "interrupted" })],
    ["пустой", answer("a1", "", { status: "complete" })],
  ] as const)("ответ %s — у него есть «повторить», и он работает", async (_, last) => {
    const server = fakeChatServer({ history: [question, last] });
    renderChat(server);

    const retry = await screen.findByRole("button", { name: "Повторить" });
    expect(retry.getAttribute("data-kind")).toBe("answer-retry");
    expect(document.querySelector('[data-kind="error-notice"]')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(server.requestsTo("retry")).toHaveLength(1));
    answerRetry(server, "Заново");
    await waitFor(() => expect(screen.getByText("Заново")).toBeTruthy());
    expect(agentMessages()).toHaveLength(1);
    expect(userMessages()).toHaveLength(1);
  });

  it("законченный непустой ответ — «повторить» нет", async () => {
    const server = fakeChatServer({ history: [question, answer("a1", "Готово", { status: "complete" })] });
    renderChat(server);
    await screen.findByText("Готово");
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });

  it("«повторить» есть только у последнего ответа", async () => {
    const server = fakeChatServer({
      history: [
        question,
        answer("a1", "", { status: "error", error: { kind: "rate_limited" } }),
        { id: "u2", role: "user", parts: [{ type: "text", text: "Ещё" }] },
        answer("a2", "Остановился", { status: "stopped" }),
      ],
    });
    renderChat(server);
    await screen.findByText(russianLabels.errors.rate_limited);
    const buttons = screen.getAllByRole("button", { name: "Повторить" });
    expect(buttons).toHaveLength(1);
    expect(agentMessages()[1]?.contains(buttons[0]!)).toBe(true);
  });

  it("ошибка посреди живого ответа — написанное на месте, ErrorNotice по виду из потока", async () => {
    const server = fakeChatServer({ history: [] });
    renderChat(server);
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(1));
    const stream = await sendQuestion(server, "Привет");
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Половина" });
    stream.push({ type: "message-metadata", messageMetadata: { status: "error", error: { kind: "rate_limited" } } });
    stream.push({ type: "error", errorText: "rate_limited" });
    stream.push({ type: "finish" });
    stream.end();

    // Итог ответа читает и диктор (announcement), поэтому ищем блок ошибки внутри самого ответа.
    await waitFor(() => expect(within(agentMessages()[0]!).getByText(russianLabels.errors.rate_limited)).toBeTruthy());
    expect(within(agentMessages()[0]!).getByText("Половина")).toBeTruthy();
    expect(agentMessages()[0]?.getAttribute("data-status")).toBe("error");
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });

  describe("сервер упал, пока вкладка открыта", () => {
    async function startAnswer(server: ReturnType<typeof fakeChatServer>) {
      renderChat(server);
      await waitFor(() => expect(server.requestsTo("history")).toHaveLength(1));
      const stream = await sendQuestion(server, "Привет");
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "text-start", id: "t" });
      stream.push({ type: "text-delta", id: "t", delta: "Успел написать" });
      await screen.findByText("Успел написать");
      return stream;
    }

    it("сервер недоступен — ответ помечен прерванным, ConnectionNotice offline с «повторить», без обновления страницы", async () => {
      const server = fakeChatServer({ history: [] });
      const stream = await startAnswer(server);

      server.state.down = true;
      act(() => stream.break());

      await waitFor(() => expect(agentMessages()[0]?.getAttribute("data-status")).toBe("interrupted"));
      expect(within(agentMessages()[0]!).getByText("Успел написать")).toBeTruthy();
      const notice = screen.getByTestId("notice");
      expect(notice.querySelector('[data-kind="connection-notice"]')?.getAttribute("data-state")).toBe("offline");
      expect(within(notice).getByText("Нет связи с сервером")).toBeTruthy();
      expect(within(notice).getByRole("button", { name: "Повторить" })).toBeTruthy();
      expect(notice.querySelector('[data-kind="error-notice"]')).toBeNull();
      expect(document.querySelector("form")?.getAttribute("data-busy")).toBe("false");
    });

    it("пока идут попытки — ConnectionNotice reconnecting без «повторить», Composer занят, «стоп» работает", async () => {
      const server = fakeChatServer({ history: [] });
      const stream = await startAnswer(server);

      server.state.hang.add("history");
      act(() => stream.break());

      const notice = await screen.findByTestId("notice");
      const connectionNotice = notice.querySelector('[data-kind="connection-notice"]');
      expect(connectionNotice?.getAttribute("data-state")).toBe("reconnecting");
      expect(within(notice).getByText("Переподключаемся…")).toBeTruthy();
      expect(within(notice).queryByRole("button")).toBeNull();
      expect(document.querySelector("form")?.getAttribute("data-busy")).toBe("true");
      expect(within(agentMessages()[0]!).getByText("Успел написать")).toBeTruthy();
      expect(agentMessages()[0]?.getAttribute("data-status")).not.toBe("interrupted");

      fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
      await waitFor(() => expect(agentMessages()[0]?.getAttribute("data-status")).toBe("stopped"));
      expect(server.requestsTo("stop")).toHaveLength(1);
      expect(screen.queryByTestId("notice")).toBeNull();
    });

    it("поток закрылся без итога ответа (прокси закрыл соединение) — тоже прерван, а не «готов»", async () => {
      const server = fakeChatServer({ history: [] });
      const stream = await startAnswer(server);

      server.state.down = true;
      act(() => stream.end());

      await waitFor(() => expect(agentMessages()[0]?.getAttribute("data-status")).toBe("interrupted"));
      expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
    });

    it("сервер уже поднялся — показывается его состояние ответа", async () => {
      const server = fakeChatServer({ history: [] });
      const stream = await startAnswer(server);

      server.state.history = [
        { id: "u-local", role: "user", parts: [{ type: "text", text: "Привет" }] },
        answer("a1", "Успел написать", { status: "interrupted" }),
      ];
      act(() => stream.break());

      await waitFor(() => expect(agentMessages()[0]?.getAttribute("data-status")).toBe("interrupted"));
      expect(userMessages()).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
    });

    it("после «повторить» при поднятом сервере — связь вернулась, ответ прерван; ещё «повторить» — новый ответ", async () => {
      const server = fakeChatServer({ history: [] });
      const stream = await startAnswer(server);
      server.state.down = true;
      act(() => stream.break());
      const reconnect = await screen.findByRole("button", { name: "Повторить" });

      // Сервер поднялся и помнит ход: вопрос дошёл, ответ помечен прерванным.
      server.state.down = false;
      server.state.history = [
        { id: "u-local", role: "user", parts: [{ type: "text", text: "Привет" }] },
        answer("a1", "Успел написать", { status: "interrupted" }),
      ];
      fireEvent.click(reconnect);
      await waitFor(() => expect(screen.queryByText("Нет связи с сервером")).toBeNull());
      expect(agentMessages()[0]?.getAttribute("data-status")).toBe("interrupted");

      fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));
      await waitFor(() => expect(server.requestsTo("retry")).toHaveLength(1));
      answerRetry(server, "После перезапуска");
      await waitFor(() => expect(screen.getByText("После перезапуска")).toBeTruthy());
      expect(agentMessages()).toHaveLength(1);
      expect(userMessages()).toHaveLength(1);
    });

    it("«повторить» в offline, пока сервер лежит, — снова offline, ответ на месте и не задвоился", async () => {
      const server = fakeChatServer({ history: [] });
      const stream = await startAnswer(server);
      server.state.down = true;
      act(() => stream.break());
      fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));

      await waitFor(() => expect(screen.getByText("Нет связи с сервером")).toBeTruthy());
      await waitFor(() => expect(document.querySelector("form")?.getAttribute("data-busy")).toBe("false"));
      expect(agentMessages()).toHaveLength(1);
      expect(agentMessages()[0]?.getAttribute("data-status")).toBe("interrupted");
      expect(within(agentMessages()[0]!).getByText("Успел написать")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
      expect(userMessages()).toHaveLength(1);
    });

    it("«повторить» у остановленного ответа, пока сервер лежит, — прежний ответ на месте и «Нет связи с сервером»", async () => {
      const server = fakeChatServer({ history: [question, answer("a1", "Недописано", { status: "stopped" })] });
      renderChat(server);
      const retry = await screen.findByRole("button", { name: "Повторить" });
      server.state.down = true;
      fireEvent.click(retry);

      await waitFor(() => expect(screen.getByText("Нет связи с сервером")).toBeTruthy());
      expect(agentMessages()).toHaveLength(1);
      expect(within(agentMessages()[0]!).getByText("Недописано")).toBeTruthy();
      expect(agentMessages()[0]?.getAttribute("data-status")).toBe("stopped");
      expect(userMessages()).toHaveLength(1);
    });
  });

  it("чужой или несуществующий чат — надпись из словаря, без «повторить» и без поля ввода", async () => {
    const server = fakeChatServer({ history: [] });
    server.state.notFound = true;
    renderChat(server, { ...russianLabels, chatNotFound: "Такого чата нет" });

    expect(await screen.findByText("Такого чата нет")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    expect(screen.queryByLabelText("поле")).toBeNull();
    expect(screen.queryByTestId("notice")).toBeNull();
    expect(screen.queryByTestId("feed")).toBeNull();
    // Ответ сервера окончательный: загрузку не повторяем и к ответу не подключаемся.
    expect(server.requests.filter((request) => !request.url.endsWith("/models")).map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /api/chat/c1",
    ]);
  });

  it("история не загрузилась по сети — «Нет связи с сервером» вместо ErrorNotice; «повторить» грузит её, и нажатая отправка уходит", async () => {
    const server = fakeChatServer({ history: [question, answer("a0", "Было", { status: "complete" })] });
    server.state.down = true;
    renderChat(server);

    const notice = await screen.findByTestId("notice");
    expect(within(notice).getByText("Нет связи с сервером")).toBeTruthy();
    expect(notice.querySelector('[data-kind="error-notice"]')).toBeNull();
    submitQuestion("Ещё вопрос");

    server.state.down = false;
    fireEvent.click(within(notice).getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.getByText("Было")).toBeTruthy());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(screen.queryByTestId("notice")).toBeNull();
    expect(userMessages()).toHaveLength(2);
  });

  it("сервер ответил 5xx на историю — прежний ErrorNotice other; «повторить» грузит историю", async () => {
    const server = fakeChatServer({ history: [question, answer("a0", "Было", { status: "complete" })] });
    server.state.fail.add("history");
    renderChat(server);

    const notice = await screen.findByTestId("notice");
    expect(within(notice).getByText(russianLabels.errors.other)).toBeTruthy();
    expect(notice.querySelector('[data-kind="connection-notice"]')).toBeNull();

    server.state.fail.delete("history");
    fireEvent.click(within(notice).getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.getByText("Было")).toBeTruthy());
    expect(screen.queryByTestId("notice")).toBeNull();
  });

  it("сервер ответил 5xx на отправку — прежний ErrorNotice other; «повторить» шлёт то же сообщение", async () => {
    const server = fakeChatServer({ history: [] });
    renderChat(server);
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(1));
    server.state.fail.add("messages");
    submitQuestion("Привет");

    const notice = await screen.findByTestId("notice");
    expect(within(notice).getByText(russianLabels.errors.other)).toBeTruthy();
    expect(notice.querySelector('[data-kind="connection-notice"]')).toBeNull();
    expect(userMessages()).toHaveLength(1);
    const sends = () => server.requestsTo("messages");
    const firstId = (sends()[0]?.body as { message: { id: string } }).message.id;

    server.state.fail.delete("messages");
    fireEvent.click(within(notice).getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect((sends()[1]?.body as { message: { id: string } }).message.id).toBe(firstId);
    expect(userMessages()).toHaveLength(1);
  });

  it("отправка не дошла до сервера по сети — «Нет связи с сервером»; «повторить» шлёт то же сообщение", async () => {
    const server = fakeChatServer({ history: [] });
    renderChat(server);
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(1));
    server.state.down = true;
    submitQuestion("Привет");

    const notice = await screen.findByTestId("notice");
    expect(within(notice).getByText("Нет связи с сервером")).toBeTruthy();
    expect(userMessages()).toHaveLength(1);
    const sends = () => server.requestsTo("messages");
    const firstId = (sends()[0]?.body as { message: { id: string } }).message.id;

    server.state.down = false;
    fireEvent.click(within(notice).getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    // Тот же id: если сервер сообщение всё же получил, он его не задвоит.
    expect((sends().at(-1)?.body as { message: { id: string; parts: unknown } }).message).toEqual(
      expect.objectContaining({ id: firstId, parts: [{ type: "text", text: "Привет" }] }),
    );
    server.streams[0]!.answer("Дошло");
    await waitFor(() => expect(screen.getByText("Дошло")).toBeTruthy());
    expect(screen.queryByTestId("notice")).toBeNull();
    expect(userMessages()).toHaveLength(1);
  });
});
