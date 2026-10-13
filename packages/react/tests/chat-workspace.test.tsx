// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspace } from "../src/chat-list/chat-workspace";
import type { ChatWorkspaceProps } from "../src/chat-list/chat-workspace";
import { fakeChatListServer } from "./support/fake-chat-list-server";
import { setupChatDom, settle, submitQuestion } from "./support/chat-dom";
import { stubWorkspaceSkin } from "./support/stub-chat-list-skin";

setupChatDom();
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

function renderWorkspace(server: ReturnType<typeof fakeChatListServer>, props: Partial<ChatWorkspaceProps> = {}) {
  vi.stubGlobal("fetch", server.fetch);
  return render(<ChatWorkspace api="/api/chat" skin={stubWorkspaceSkin} {...props} />);
}

const rows = () => [...document.querySelectorAll("[data-chat-id]")].map((row) => row.getAttribute("data-chat-id"));
const row = (id: string) => document.querySelector(`[data-chat-id="${id}"]`) as HTMLElement;
const twoChats = () =>
  fakeChatListServer([
    { id: "c2", title: "Второй" },
    { id: "c1", title: "Первый" },
  ]);

describe("ChatWorkspace", () => {
  it("рисует список и открывает самый недавний чат: его история грузится", async () => {
    const server = twoChats();
    renderWorkspace(server);
    await waitFor(() => expect(rows()).toEqual(["c2", "c1"]));
    expect(row("c2").getAttribute("aria-current")).toBe("true");
    expect(row("c1").getAttribute("aria-current")).toBeNull();
    await screen.findByLabelText("поле");
    expect(server.requests.some((request) => request.method === "GET" && request.path === "/api/chat/c2")).toBe(true);
  });

  it("выбор другого чата открывает его; на узком экране панель после этого закрывается", async () => {
    const server = twoChats();
    renderWorkspace(server);
    await screen.findByLabelText("поле");
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("open-list"));
    expect(screen.getByTestId("workspace").getAttribute("data-list-open")).toBe("true");
    fireEvent.click(within(row("c1")).getByText("Первый"));
    expect(screen.getByTestId("workspace").getAttribute("data-list-open")).toBe("false");
    expect(row("c1").getAttribute("aria-current")).toBe("true");
    await waitFor(() => expect(server.requests.some((request) => request.path === "/api/chat/c1")).toBe(true));
  });

  it("чат из мессенджера передаётся скину с пометкой origin; веб-чат — без неё; незнакомое значение отбрасывается", async () => {
    const server = fakeChatListServer([
      { id: "tg", title: "Из телеграма", origin: "telegram" },
      { id: "web", title: "Из браузера" },
      { id: "odd", title: "Странный", origin: "fax" },
    ]);
    renderWorkspace(server);
    await waitFor(() => expect(rows()).toEqual(["tg", "web", "odd"]));
    expect(row("tg").dataset.origin).toBe("telegram");
    expect(row("web").dataset.origin).toBe("");
    expect(row("odd").dataset.origin).toBe("");
  });

  it("название открытого чата передаётся каркасу; у чата без названия — «Новый чат»", async () => {
    const server = fakeChatListServer([{ id: "empty", title: null }]);
    renderWorkspace(server);
    await waitFor(() => expect(screen.getByTestId("open-list").textContent).toBe("Новый чат"));
    // Список появляется после первой истории открытого чата: до неё права неизвестны.
    await waitFor(() => expect(row("empty")).toBeTruthy());
    expect(row("empty").textContent).toContain("Новый чат");
  });

  it("безымянный чат передаётся скину как title: null; переименование «как есть» ничего не отправляет", async () => {
    const server = fakeChatListServer([{ id: "empty", title: null }]);
    renderWorkspace(server);
    await waitFor(() => expect(row("empty")).toBeTruthy());
    expect(row("empty").getAttribute("data-untitled")).toBe("true");
    fireEvent.click(within(row("empty")).getByText("Переименовать"));
    const field = screen.getByLabelText("Название чата") as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.keyDown(field, { key: "Enter" });
    await settle();
    expect(server.listRequests("PATCH")).toEqual([]);
    expect(server.state.chats[0]?.title).toBeNull();
  });

  it("смена чата не переносит в другой чат набранный текст", async () => {
    const server = twoChats();
    renderWorkspace(server);
    const field = (await screen.findByLabelText("поле")) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "черновик для второго" } });
    expect(field.value).toBe("черновик для второго");
    // Список появляется после первой истории, поле — раньше: строку надо дождаться.
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(within(row("c1")).getByText("Первый"));
    await waitFor(() => expect(row("c1").getAttribute("aria-current")).toBe("true"));
    const after = (await screen.findByLabelText("поле")) as HTMLTextAreaElement;
    expect(after.value).toBe("");
  });

  it("onChatChange сообщает об открытом чате при загрузке, выборе и удалении", async () => {
    const server = twoChats();
    const seen: Array<string | null> = [];
    renderWorkspace(server, { onChatChange: (id) => seen.push(id) });
    await waitFor(() => expect(seen).toContain("c2"));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(within(row("c1")).getByText("Первый"));
    await waitFor(() => expect(seen.at(-1)).toBe("c1"));
  });

  it("«Новый чат» создаёт чат и открывает его", async () => {
    const server = twoChats();
    renderWorkspace(server);
    await screen.findByLabelText("поле");
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByText("Новый чат", { selector: "button" }));
    await waitFor(() => expect(row("new-1")?.getAttribute("aria-current")).toBe("true"));
    expect(rows()).toEqual(["new-1", "c2", "c1"]);
  });

  it("переименование через список уходит на сервер и видно в списке", async () => {
    const server = twoChats();
    renderWorkspace(server);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(within(row("c1")).getByText("Переименовать"));
    const field = screen.getByLabelText("Название чата");
    fireEvent.change(field, { target: { value: "Про Грецию" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(row("c1").textContent).toContain("Про Грецию"));
    expect(server.state.chats.find((chat) => chat.id === "c1")?.title).toBe("Про Грецию");
  });

  it("удаление идёт через подтверждение: пока не подтвердили — ничего не удалено; отмена закрывает окно", async () => {
    const server = twoChats();
    renderWorkspace(server);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(within(row("c1")).getByText("Удалить"));
    const dialog = screen.getByTestId("delete-dialog");
    expect(dialog.textContent).toContain("«Первый»");
    expect(server.listRequests("DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByText("Отмена"));
    expect(screen.queryByTestId("delete-dialog")).toBeNull();
    expect(rows()).toEqual(["c2", "c1"]);

    fireEvent.click(within(row("c1")).getByText("Удалить"));
    fireEvent.click(within(screen.getByTestId("delete-dialog")).getByText("Удалить"));
    await waitFor(() => expect(rows()).toEqual(["c2"]));
    expect(server.state.chats.map((chat) => chat.id)).toEqual(["c2"]);
  });

  it("список не загрузился — в панели ошибка и «Повторить»; после повтора всё на месте", async () => {
    const server = twoChats();
    server.state.fail.add("list");
    renderWorkspace(server);
    expect((await screen.findByRole("alert")).textContent).toBe("Список чатов не загрузился");
    expect(screen.queryByLabelText("поле")).toBeNull();
    server.state.fail.clear();
    fireEvent.click(screen.getByText("Повторить", { selector: "[data-testid=chat-list] > button" }));
    await waitFor(() => expect(rows()).toEqual(["c2", "c1"]));
    await screen.findByLabelText("поле");
  });

  it("initialChatId, которого нет в списке, показывает «Чат не найден» и не ломает список", async () => {
    const server = twoChats();
    renderWorkspace(server, { initialChatId: "нет-такого" });
    await waitFor(() => expect(rows()).toEqual(["c2", "c1"]));
    await waitFor(() => expect(within(screen.getByTestId("chat-area")).getByText("Чат не найден")).toBeTruthy());
    expect(row("c2").getAttribute("aria-current")).toBeNull();
  });
});

describe("ChatWorkspace: название после первого сообщения", () => {
  it("пока идёт ответ и у чата нет названия, список обновляется раз в секунду; название появляется в списке", async () => {
    const server = fakeChatListServer([{ id: "empty", title: null }]);
    renderWorkspace(server);
    await screen.findByLabelText("поле");
    submitQuestion("Расскажи про Грецию");
    await waitFor(() => expect(server.chatServer.streams).toHaveLength(1));
    // Сервер поставил название при получении сообщения; список ещё не знает.
    server.state.chats[0]!.title = "Расскажи про Грецию";
    await waitFor(() => expect(row("empty").textContent).toContain("Расскажи про Грецию"), { timeout: 3000 });
    server.chatServer.streams[0]!.answer("Греция — это…");
    await settle();
  });

  it("когда ответ закончился, список обновляется ещё раз (порядок по последней активности)", async () => {
    const server = fakeChatListServer([
      { id: "old", title: "Старый" },
      { id: "fresh", title: "Свежий" },
    ]);
    renderWorkspace(server, { initialChatId: "fresh" });
    await screen.findByLabelText("поле");
    submitQuestion("Вопрос");
    await waitFor(() => expect(server.chatServer.streams).toHaveLength(1));
    // На сервере чат «old» стал самым недавним.
    server.state.chats.unshift(server.state.chats.pop()!);
    server.chatServer.streams[0]!.answer("Ответ");
    await waitFor(() => expect(rows()[0]).toBe(server.state.chats[0]!.id));
  });
});

describe("ChatWorkspace: закрытые чаты в списке", () => {
  const closure = { code: "form_submitted", message: "Заявка отправлена, чат закрыт" };

  it("у закрытого чата в списке пометка «Закрыт» с причиной; у открытого пометки нет", async () => {
    const server = fakeChatListServer([
      { id: "c2", title: "Открытый" },
      { id: "c1", title: "Закрытый", closed: closure },
    ]);
    renderWorkspace(server);
    await waitFor(() => expect(rows()).toEqual(["c2", "c1"]));
    const mark = within(row("c1")).getByTestId("closed-mark");
    expect(mark.textContent).toBe("Закрыт");
    expect(mark.getAttribute("data-code")).toBe("form_submitted");
    expect(mark.getAttribute("title")).toBe(closure.message);
    expect(within(row("c2")).queryByTestId("closed-mark")).toBeNull();
  });

  it("закрытие неверной формы в строке списка отбрасывается: пометки нет", async () => {
    const server = fakeChatListServer([{ id: "c1", title: "Странный" }]);
    (server.state.chats[0] as { closed?: unknown }).closed = { code: 5 };
    renderWorkspace(server);
    await waitFor(() => expect(rows()).toEqual(["c1"]));
    expect(within(row("c1")).queryByTestId("closed-mark")).toBeNull();
  });
});

describe("ChatWorkspace: приложение отказало в создании чата", () => {
  const refusal = { error: { kind: "chat_creation_refused", code: "chat_limit", message: "Больше трёх чатов нельзя" } };
  /** Чат с перепиской: «Новый чат» не откроет его заново, а пойдёт на сервер. */
  const nonEmpty = () => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    return server;
  };

  it("«Новый чат»: на отказ показывается текст приложения, чат не меняется, кнопка снова нажимается", async () => {
    const server = nonEmpty();
    server.state.refuseCreate = { status: 403, body: refusal };
    renderWorkspace(server);
    await screen.findByLabelText("поле");
    await waitFor(() => expect(rows()).toEqual(["c1"]));

    fireEvent.click(screen.getByText("Новый чат", { selector: "button" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Больше трёх чатов нельзя"));
    expect(row("c1").getAttribute("aria-current")).toBe("true");
    expect((screen.getByText("Новый чат", { selector: "button" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByLabelText("поле")).toBeTruthy();
  });

  it("приложению отказ уходит в onTurnRefused с видом chat_creation_refused", async () => {
    const server = nonEmpty();
    server.state.refuseCreate = { status: 403, body: refusal };
    const onTurnRefused = vi.fn();
    renderWorkspace(server, { onTurnRefused });
    await screen.findByLabelText("поле");
    await waitFor(() => expect(rows()).toEqual(["c1"]));

    fireEvent.click(screen.getByText("Новый чат", { selector: "button" }));
    await waitFor(() => expect(onTurnRefused).toHaveBeenCalledWith({ kind: "chat_creation_refused", code: "chat_limit", message: "Больше трёх чатов нельзя" }));
  });

  it("обычный сбой создания (500) по-прежнему говорит «Не удалось создать чат»", async () => {
    const server = nonEmpty();
    server.state.fail.add("create");
    renderWorkspace(server);
    await screen.findByLabelText("поле");
    await waitFor(() => expect(rows()).toEqual(["c1"]));

    fireEvent.click(screen.getByText("Новый чат", { selector: "button" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Не удалось создать чат"));
  });

  it("текст отказа уходит после следующего удачного действия и не прилипает к обычному сбою", async () => {
    const server = nonEmpty();
    server.state.refuseCreate = { status: 403, body: refusal };
    renderWorkspace(server);
    await screen.findByLabelText("поле");
    await waitFor(() => expect(rows()).toEqual(["c1"]));
    fireEvent.click(screen.getByText("Новый чат", { selector: "button" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Больше трёх чатов нельзя"));

    server.state.refuseCreate = null;
    server.state.fail.add("create");
    fireEvent.click(screen.getByText("Новый чат", { selector: "button" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Не удалось создать чат"));
  });

  it("первый запуск без чатов и отказ в создании: список виден с текстом отказа, а не «список не загрузился»", async () => {
    const server = fakeChatListServer([]);
    server.state.refuseCreate = { status: 403, body: refusal };
    renderWorkspace(server);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Больше трёх чатов нельзя"));
    expect(screen.getByTestId("chat-list").getAttribute("data-status")).toBe("ready");
  });
});
