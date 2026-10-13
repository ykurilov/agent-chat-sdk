// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { russianLabels } from "../src/labels";
import type { ChatSkin, WidgetView } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, renderChatHook, setupChatDom, submitQuestion } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const answered: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте", state: "done" }], metadata: { status: "complete" } };

const closed = { kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" };
const noCourse = { kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" };

const field = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const errorNotice = () => document.querySelector('[data-kind="error-notice"]') as HTMLElement | null;
const pause = (ms = 50) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

async function openChat(server: ReturnType<typeof fakeChatServer>, props: Parameters<typeof renderAgentChat>[1] = {}) {
  renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] }, ...props });
  await screen.findByText("Здравствуйте");
}

describe("AgentChat: приложение отказало ходу (turn_refused)", () => {
  it("отправка: текст отказа виден, «Повторить» нет, текст вернулся в поле, повторов нет, onTurnRefused получил код", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server, { onTurnRefused });

    server.state.refuse.messages = { status: 403, kind: "", body: { error: closed } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Урок закрыт"));
    expect(within(errorNotice()!).queryByRole("button")).toBeNull();
    expect(field().value).toBe("Как дела?");
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(1);
    expect(onTurnRefused).toHaveBeenCalledTimes(1);
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" });
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(1);
  });

  it("«Переделать»: прежний ответ на месте, текст отказа, onTurnRefused зовётся", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server, { onTurnRefused });

    server.state.refuse.regenerate = { status: 403, kind: "", body: { error: closed } };
    fireEvent.click(screen.getByText(russianLabels.regenerate));

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Урок закрыт"));
    expect(within(errorNotice()!).queryByRole("button")).toBeNull();
    expect(onTurnRefused).toHaveBeenCalledWith(expect.objectContaining({ code: "lesson_closed", kind: "turn_refused" }));
  });

  it("правка: редактор открыт с текстом и надписью приложения; исход несёт код отказа", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({ history: [question, answered] });
    const { result } = renderChatHook(server, { onTurnRefused });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    server.state.refuse.edit = { status: 403, kind: "", body: { error: closed } };
    let outcome: Awaited<ReturnType<typeof result.current.edit>> | undefined;
    await act(async () => {
      outcome = await result.current.edit("u1", "Добрый день");
    });

    expect(outcome).toEqual({ status: "refused", reason: "server_refused", text: "Урок закрыт", code: "lesson_closed" });
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" });
  });

  it("подтверждение: «нет связи» не показывается, карточка остаётся с текстом приложения", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Удали заметки" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "step-start" },
            { type: "tool-delete_notes", title: "Удалить заметки", toolCallId: "call-1", state: "approval-requested", input: {}, approval: { id: "ap1" } },
          ],
          metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
        },
      ],
    });
    server.state.approval = { status: 403, body: { error: closed } };
    renderAgentChat(server, { onTurnRefused });
    await waitFor(() => expect(document.querySelector('[data-kind="tool"]')).toBeTruthy());

    fireEvent.click(screen.getByLabelText("allow"));

    const row = () => document.querySelector('[data-kind="tool"]') as HTMLElement;
    await waitFor(() => expect(row().getAttribute("data-approval-failed")).toBe("true"));
    expect(row().getAttribute("data-approval-failure")).toBe("Урок закрыт");
    expect(row().getAttribute("data-approval")).toBe("requested");
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" });
  });

  it("ответ на виджет: виджет снова активен, причина — текст приложения", async () => {
    const onTurnRefused = vi.fn();
    const probeSkin: ChatSkin = {
      ...stubSkin,
      Widget: (view: WidgetView) => (
        <div data-kind="widget" data-failure={view.failure ?? ""}>
          {view.kind === "choice" &&
            view.options.map((option) => (
              <button key={option} type="button" onClick={() => view.onChoose?.(option)}>
                {option}
              </button>
            ))}
        </div>
      ),
    };
    const server = fakeChatServer({
      history: [
        question,
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "step-start" }, { type: "tool-ask_choice", toolCallId: "w1", state: "input-available", input: { question: "Куда?", options: ["Море", "Горы"] } }],
          metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
        },
      ],
    });
    server.state.widget = { status: 403, body: { error: closed } };
    renderAgentChat(server, { skin: probeSkin, onTurnRefused });
    await waitFor(() => expect(document.querySelector('[data-kind="widget"]')).toBeTruthy());

    fireEvent.click(screen.getByText("Море"));

    await waitFor(() => expect(document.querySelector('[data-kind="widget"]')!.getAttribute("data-failure")).toBe("Урок закрыт"));
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" });
  });
});

describe("AgentChat: приложение отказало в доступе (access_refused)", () => {
  it("отправка 403: тот же показ, kind access_refused", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server, { onTurnRefused });

    server.state.refuse.messages = { status: 403, kind: "", body: { error: noCourse } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Нужен доступ к курсу"));
    expect(field().value).toBe("Как дела?");
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" });
  });

  it("отправка 401: слова приложения, а не «Вход истёк»; текст вернулся в поле", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.messages = { status: 401, kind: "", body: { error: { ...noCourse, code: "session_expired", message: "Войдите заново через школу" } } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Войдите заново через школу"));
    expect(errorNotice()!.getAttribute("data-error-kind")).toBe("other");
    expect(document.body.textContent).not.toContain(russianLabels.errors.signed_out);
    expect(field().value).toBe("Как дела?");
  });

  it("загрузка истории 403: вместо чата — текст приложения, поля ввода нет, onTurnRefused зовётся один раз", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({ history: [question, answered] });
    server.state.refuse.history = { status: 403, kind: "", body: { error: noCourse } };
    renderAgentChat(server, { onTurnRefused });

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Нужен доступ к курсу"));
    expect(screen.queryByLabelText("поле")).toBeNull();
    expect(document.querySelector('[data-kind="user"]')).toBeNull();
    expect(onTurnRefused).toHaveBeenCalledTimes(1);
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" });
  });

  it("доступ вернули — следующая успешная загрузка истории убирает отказ, чат открывается", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.refuse.history = { status: 403, kind: "", body: { error: noCourse } };
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.accessRefusal?.text).toBe("Нужен доступ к курсу"));

    delete server.state.refuse.history;
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.accessRefusal).toBeNull();
  });

  it("загрузка истории 403: «Повторить» на экране отказа; доступ вернули — повтор открывает чат", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.refuse.history = { status: 403, kind: "", body: { error: noCourse } };
    renderAgentChat(server);
    await waitFor(() => expect(errorNotice()?.textContent).toContain("Нужен доступ к курсу"));

    delete server.state.refuse.history;
    fireEvent.click(within(errorNotice()!).getByRole("button", { name: russianLabels.retry }));

    await screen.findByText("Здравствуйте");
    expect(errorNotice()).toBeNull();
    expect(screen.getByLabelText("поле")).toBeTruthy();
  });

  it("загрузка истории 401: тоже слова приложения, а не «Вход истёк»", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.refuse.history = { status: 401, kind: "", body: { error: noCourse } };
    renderAgentChat(server);

    await waitFor(() => expect(errorNotice()?.textContent).toContain("Нужен доступ к курсу"));
    expect(document.body.textContent).not.toContain(russianLabels.errors.signed_out);
  });
});

describe("AgentChat: обычные отказы не затронуты", () => {
  it("401 без вида приложения — по-прежнему «Вход истёк»", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server);

    server.state.refuse.messages = { status: 401, kind: "invalid" };
    submitQuestion("Как дела?");

    await waitFor(() => expect(errorNotice()?.getAttribute("data-error-kind")).toBe("signed_out"));
  });
});
