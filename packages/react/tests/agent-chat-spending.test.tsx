// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { russianLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, setupChatDom, submitQuestion } from "./support/chat-dom";

setupChatDom();

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const answered: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте", state: "done" }], metadata: { status: "complete" } };

const noticeElement = () => document.querySelector('[data-kind="spending-notice"]') as HTMLElement | null;
const field = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const sendButton = () => field().closest("form")!.querySelector('button[type="submit"]') as HTMLButtonElement;

/** Ждёт условия, двигая часы теста: таймеры вкладки при поддельных часах сами не идут. */
async function until(condition: () => boolean) {
  for (let step = 0; step < 100 && !condition(); step++) await act(() => vi.advanceTimersByTimeAsync(20));
  expect(condition()).toBe(true);
}

const nearlyOut = { state: "warning", scope: "user", period: "month", share: 0.83, resetsAt: "2026-11-01T00:00:00.000Z" };
const outOfBudget = { state: "exhausted", scope: "user", period: "month", share: 1.02, resetsAt: "2026-11-01T00:00:00.000Z" };

describe("AgentChat: лимиты расходов", () => {
  it("без spendingLimits адрес лимитов не спрашивается и надписи нет", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = outOfBudget;
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");

    expect(server.requestsTo("spending")).toHaveLength(0);
    expect(noticeElement()).toBeNull();
    expect(sendButton().disabled).toBe(true); // пустое поле; кнопка не заблокирована лимитом
    fireEvent.change(field(), { target: { value: "ещё" } });
    expect(sendButton().disabled).toBe(false);
  });

  it("область для диктора есть в DOM с самого начала (до ответа сервера), пустая, пока лимит не подошёл; без spendingLimits её нет", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = outOfBudget;
    renderAgentChat(server, { spendingLimits: true });
    const region = noticeElement();
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe("");
    expect(region!.getAttribute("data-state")).toBe("none");
    await waitFor(() => expect(noticeElement()!.textContent).toBe("Лимит на месяц исчерпан, обновится 1 ноября"));
    // Тот же элемент, а не новый: диктор читает изменение в уже стоявшей области.
    expect(noticeElement()).toBe(region);
  });

  it("без spendingLimits области для диктора нет", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");
    expect(noticeElement()).toBeNull();
  });

  it("исчерпание: заблокированное поле связано с надписью через aria-describedby", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = outOfBudget;
    renderAgentChat(server, { spendingLimits: true });
    await waitFor(() => expect(noticeElement()!.textContent).not.toBe(""));
    const describedBy = field().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toBe(noticeElement());
  });

  it("предупреждение поле не блокирует и связью не нагружает", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = nearlyOut;
    renderAgentChat(server, { spendingLimits: true });
    await waitFor(() => expect(noticeElement()!.textContent).toBe("Использовано 83% лимита на месяц"));
    expect(field().getAttribute("aria-describedby")).toBeNull();
  });

  it("в пределах бюджета надпись пуста, отправка доступна", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = { state: "ok", scope: "user", period: "month", share: 0.2, resetsAt: "2026-11-01T00:00:00.000Z" };
    renderAgentChat(server, { spendingLimits: true });
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(server.requestsTo("spending")).toHaveLength(1));

    expect(noticeElement()!.textContent).toBe("");
    fireEvent.change(field(), { target: { value: "ещё" } });
    expect(sendButton().disabled).toBe(false);
  });

  it("предупреждение при 83%: надпись из словаря, отправка доступна", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = nearlyOut;
    renderAgentChat(server, { spendingLimits: true });

    await waitFor(() => expect(noticeElement()!.getAttribute("data-state")).not.toBe("none"));
    expect(noticeElement()!.getAttribute("data-state")).toBe("warning");
    expect(noticeElement()!.textContent).toBe("Использовано 83% лимита на месяц");
    expect(field().closest("form")!.getAttribute("data-sending-blocked")).toBe("false");
    fireEvent.change(field(), { target: { value: "ещё" } });
    expect(sendButton().disabled).toBe(false);
  });

  it("лимит исчерпан: надпись с датой обновления, отправка неактивна, правка, повтор и переделка недоступны", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = outOfBudget;
    renderAgentChat(server, { spendingLimits: true });

    await waitFor(() => expect(noticeElement()!.getAttribute("data-state")).not.toBe("none"));
    expect(noticeElement()!.getAttribute("data-state")).toBe("exhausted");
    expect(noticeElement()!.textContent).toBe("Лимит на месяц исчерпан, обновится 1 ноября");
    fireEvent.change(field(), { target: { value: "ещё" } });
    expect(sendButton().disabled).toBe(true);
    expect(field().closest("form")!.getAttribute("data-sending-blocked")).toBe("true");
    submitQuestion("ещё");
    expect(server.requestsTo("messages")).toHaveLength(0);
    expect(document.querySelector('[data-action="regenerate"]')).toBeNull();
    expect(document.querySelector('[data-action="edit"]')).toBeNull();
  });

  it("надписи берутся из словаря приложения", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = outOfBudget;
    renderAgentChat(server, {
      spendingLimits: true,
      labels: { ...russianLabels, spendingExhausted: (info) => `Всё! Период: ${info.period}` },
    });
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Всё! Период: month"));
  });

  it("лимит чата и суточный период называются в надписи", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = { state: "exhausted", scope: "chat", period: "day", share: 1, resetsAt: "2026-10-02T00:00:00.000Z" };
    renderAgentChat(server, { spendingLimits: true });
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Лимит этого чата на день исчерпан, обновится 2 октября"));
  });

  it("дата обновления — по поясу лимитов: суточный лимит Москвы обнуляется 4 октября, а не 3-го", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = { state: "exhausted", scope: "user", period: "day", share: 1, resetsAt: "2026-10-03T21:00:00.000Z", timeZone: "Europe/Moscow" };
    renderAgentChat(server, { spendingLimits: true });
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Лимит на день исчерпан, обновится 4 октября"));
  });

  it("лимит без периода: обновления не будет", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = { state: "exhausted", scope: "user", period: "none", share: 1, resetsAt: null };
    renderAgentChat(server, { spendingLimits: true });
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Лимит исчерпан"));
  });

  it("сервер без лимитов (404 на адресе): чат работает как обычно, надпись пуста", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    renderAgentChat(server, { spendingLimits: true });
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(server.requestsTo("spending")).toHaveLength(1));

    expect(noticeElement()!.textContent).toBe("");
    fireEvent.change(field(), { target: { value: "ещё" } });
    expect(sendButton().disabled).toBe(false);
  });

  it("после законченного ответа лимиты читаются заново: появляется предупреждение", async () => {
    const server = fakeChatServer({ history: [] });
    server.state.spending = { state: "ok", scope: "user", period: "month", share: 0.5 };
    renderAgentChat(server, { spendingLimits: true });
    const stream = await sendQuestion(server, "Привет");
    expect(noticeElement()!.textContent).toBe("");

    server.state.spending = nearlyOut;
    await act(async () => stream.answer("Готово"));
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Использовано 83% лимита на месяц"));
  });

  it("отказ 429 на отправке: текст возвращается в поле, сообщения в ленте нет, повторных попыток нет, надпись «исчерпан»", async () => {
    const server = fakeChatServer({ history: [] });
    server.state.spending = { state: "ok", scope: "user", period: "month", share: 0.99 };
    renderAgentChat(server, { spendingLimits: true, liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByLabelText("поле");
    await waitFor(() => expect(server.requestsTo("spending")).toHaveLength(1));

    server.state.refuseSpending = { scope: "user", period: "month", resetsAt: "2026-11-01T00:00:00.000Z" };
    server.state.spending = outOfBudget;
    submitQuestion("Расскажи анекдот");

    await waitFor(() => expect(noticeElement()?.textContent).toBe("Лимит на месяц исчерпан, обновится 1 ноября"));
    expect(field().value).toBe("Расскажи анекдот");
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(0);
    expect(sendButton().disabled).toBe(true);
    // Ни «Переподключаемся…», ни «Нет связи», ни «Что-то пошло не так».
    expect(document.querySelector('[data-kind="connection-notice"]')).toBeNull();
    expect(document.querySelector('[data-kind="error-notice"]')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(server.requestsTo("messages")).toHaveLength(1);
    // История прочитана дважды: при открытии и после отказа (сверка с тем, что записал сервер). Серии попыток нет.
    expect(server.requestsTo("history")).toHaveLength(2);
  });

  it("лимит сообщений: предупреждение «Осталось 1 сообщение», отказ 429 — «Лимит сообщений исчерпан, обновится …»", async () => {
    const server = fakeChatServer({ history: [] });
    server.state.spending = { state: "warning", scope: "user", period: "day", share: 0.8, resetsAt: "2026-10-08T00:00:00.000Z", windowId: "day", unit: "messages", remaining: 1 };
    renderAgentChat(server, { spendingLimits: true, liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Осталось 1 сообщение"));
    expect(field().getAttribute("aria-describedby")).toBeNull();

    server.state.refuseSpending = { scope: "user", period: "day", resetsAt: "2026-10-08T00:00:00.000Z", reason: "limit", windowId: "day", unit: "messages" };
    server.state.spending = { state: "exhausted", reason: "limit", scope: "user", period: "day", share: 1, resetsAt: "2026-10-08T00:00:00.000Z", windowId: "day", unit: "messages", remaining: 0 };
    submitQuestion("Ещё вопрос");
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Лимит сообщений исчерпан, обновится 8 октября"));
    expect(field().value).toBe("Ещё вопрос");
    expect(sendButton().disabled).toBe(true);
  });

  it("отказ 429 на правку: редактор остаётся открытым с исправленным текстом, поле ввода не трогается, лента прежняя", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = { state: "ok", scope: "user", period: "month", share: 0.99 };
    renderAgentChat(server, { spendingLimits: true, liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = () => document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    const editorField = () => within(editor()).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement;
    fireEvent.change(editorField(), { target: { value: "Добрый день" } });

    server.state.refuseSpending = { scope: "user", period: "month", resetsAt: "2026-11-01T00:00:00.000Z" };
    server.state.spending = outOfBudget;
    fireEvent.submit(editor());

    await waitFor(() => expect(noticeElement()?.textContent).toBe("Лимит на месяц исчерпан, обновится 1 ноября"));
    expect(editor()).not.toBeNull();
    expect(editorField().value).toBe("Добрый день");
    expect((await screen.findByRole("alert")).textContent).toBe(russianLabels.editErrors.spendingLimit);
    expect(field().value).toBe("");
    expect(screen.getByText("Здравствуйте")).toBeTruthy();
    expect(server.requestsTo("edit")).toHaveLength(1);
    expect(document.querySelector('[data-kind="connection-notice"]')).toBeNull();
  });

  it("правка при исчерпанных сообщениях: в редакторе — про сообщения, а не про расходы", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = { state: "ok" };
    renderAgentChat(server, { spendingLimits: true, liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Здравствуйте");
    fireEvent.click(screen.getByText(russianLabels.editMessage));
    const editor = () => document.querySelector('[data-kind="message-editor"]') as HTMLElement;
    const editorField = () => within(editor()).getByLabelText(russianLabels.editMessage) as HTMLTextAreaElement;
    fireEvent.change(editorField(), { target: { value: "Добрый день" } });

    server.state.refuseSpending = { scope: "user", period: "day", resetsAt: "2026-10-08T00:00:00.000Z", reason: "limit", windowId: "day", unit: "messages" };
    server.state.spending = { state: "exhausted", reason: "limit", scope: "user", period: "day", share: 1, resetsAt: "2026-10-08T00:00:00.000Z", windowId: "day", unit: "messages", remaining: 0 };
    fireEvent.submit(editor());

    expect((await screen.findByRole("alert")).textContent).toBe("Лимит сообщений исчерпан. Текст сохранён в поле");
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Лимит сообщений исчерпан, обновится 8 октября"));
    expect(editorField().value).toBe("Добрый день");
  });

  it("переделка упёрлась в денежное окно рядом с окнами сообщений — надпись про деньги", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.spending = { state: "warning", scope: "user", period: "day", share: 0.8, resetsAt: "2026-10-08T00:00:00.000Z", windowId: "day", unit: "messages", remaining: 1 };
    renderAgentChat(server, { spendingLimits: true, liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Здравствуйте");
    server.state.refuseSpending = { scope: "user", period: "month", resetsAt: "2026-11-01T00:00:00.000Z", reason: "limit", windowId: "money" };
    server.state.spending = { ...outOfBudget, windowId: "money", reason: "limit" };
    fireEvent.click(screen.getByText(russianLabels.regenerate));
    await waitFor(() => expect(noticeElement()?.textContent).toBe("Лимит на месяц исчерпан, обновится 1 ноября"));
  });

  it("отказ 429 работает и без spendingLimits: ход не крутится, текст не пропадает", async () => {
    const server = fakeChatServer({ history: [] });
    renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByLabelText("поле");
    server.state.refuseSpending = { scope: "user", period: "month", resetsAt: null };
    submitQuestion("Привет");

    await waitFor(() => expect(field().value).toBe("Привет"));
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(0);
    expect(document.querySelector('[data-kind="connection-notice"]')).toBeNull();
    expect(server.requestsTo("messages")).toHaveLength(1);
  });

  it("исчерпание снимается само в момент обновления", async () => {
    // Момент обновления наступает по часам теста: настоящие 150 мс под нагрузкой проходили раньше,
    // чем тест успевал сменить ответ сервера, и вкладка снова слышала «исчерпан».
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const server = fakeChatServer({ history: [question, answered] });
      const resetsAt = Date.now() + 60_000;
      server.state.spending = { ...outOfBudget, resetsAt: new Date(resetsAt).toISOString() };
      renderAgentChat(server, { spendingLimits: true });
      await until(() => noticeElement()?.getAttribute("data-state") === "exhausted");
      const asked = server.requestsTo("spending").length;

      server.state.spending = { state: "ok", scope: "user", period: "month", share: 0 };
      await act(() => vi.advanceTimersByTimeAsync(resetsAt - Date.now() - 1));
      expect(server.requestsTo("spending")).toHaveLength(asked);
      await act(() => vi.advanceTimersByTimeAsync(1));
      await until(() => noticeElement()?.textContent === "");
      fireEvent.change(field(), { target: { value: "ещё" } });
      expect(sendButton().disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
