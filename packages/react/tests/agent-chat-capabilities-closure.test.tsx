// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { AttachmentsController, AttachmentsPlugin } from "../src/attachments-contract";
import { ChatWorkspace } from "../src/chat-list/chat-workspace";
import type { ChatSkin, WidgetView } from "../src/skin-contract";
import type { VoiceInput } from "../src/voice-input";
import { russianLabels } from "../src/labels";
import { useAgentChat } from "../src/use-agent-chat";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { fakeChatListServer } from "./support/fake-chat-list-server";
import { renderAgentChat, renderChatHook, setupChatDom, submitQuestion } from "./support/chat-dom";
import { stubWorkspaceSkin } from "./support/stub-chat-list-skin";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const answered: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте", state: "done" }], metadata: { status: "complete" } };
const interrupted: HistoryMessage = { ...answered, metadata: { status: "interrupted" } };
const otherAnswer: HistoryMessage = { id: "a0", role: "assistant", parts: [{ type: "text", text: "Прежний", state: "done" }], metadata: { status: "complete" } };
const forks = [{ messageId: "a1", parentId: "u1", siblingIds: ["a0", "a1"] }];

const closure = { code: "form_submitted", message: "Заявка отправлена, чат закрыт" };
const allowed = { edit: true, regenerate: true, retry: true, branches: true, modelChoice: true, answerEditing: true, chatList: true, compact: true, attachments: true, voice: true, reasoning: true, toolDetails: true, steer: true, modelDetails: true };

const field = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const composer = () => field().closest("form")!;
const errorNotices = () => document.querySelectorAll('[data-kind="error-notice"]');
const pause = (ms = 50) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** Скин с кнопкой правки ответа (песочница): видно, дала ли лента `onEdit`. */
const answerEditSkin: ChatSkin = {
  ...stubSkin,
  AgentMessage: (props) => (
    <>
      <stubSkin.AgentMessage {...props} />
      {props.onEdit && <button type="button" data-action="edit-answer" onClick={props.onEdit} />}
    </>
  ),
};

/** Скин договора 20: своя надпись о закрытом чате. */
const closedNoticeSkin: ChatSkin = {
  ...stubSkin,
  ChatClosedNotice: ({ id, code, message }) => (
    <div id={id} data-kind="chat-closed-notice" data-code={code} role="status" tabIndex={-1}>
      {message}
    </div>
  ),
};

function fakeAttachments(): AttachmentsPlugin {
  const controller: AttachmentsController = {
    composer: { items: [], onAddFiles: vi.fn(), onRemove: vi.fn(), accept: ".txt" },
    ready: true,
    hasFiles: false,
    readFiles: () => [],
    markSent: vi.fn(),
    restoreFiles: vi.fn(),
    describe: () => undefined,
  };
  return { useController: () => controller };
}

const fakeVoice: VoiceInput = { start: () => ({ stop: () => {}, cancel: () => {} }) };

async function openChat(server: ReturnType<typeof fakeChatServer>, props: Parameters<typeof renderAgentChat>[1] = {}) {
  renderAgentChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] }, ...props });
  await screen.findByText("Здравствуйте");
}

describe("права посетителя на экране", () => {
  it("сервер до 0.27 (прав в истории нет): всё доступно, как раньше", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.forks = forks;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.capabilities).toEqual(allowed);
    expect(result.current.closed).toBeNull();
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canRegenerate).toBe(true);
  });

  it("запрещённые права прячут правку, «Переделать», стрелки веток, выбор модели и правку ответа", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.forks = forks;
    server.state.capabilities = { ...allowed, edit: false, regenerate: false, branches: false, modelChoice: false, answerEditing: false };
    await openChat(server, { skin: answerEditSkin, answerEditing: { edits: new Map(), renderEditor: () => null } });
    await pause();

    expect(document.querySelector('[data-action="edit"]')).toBeNull();
    expect(screen.queryByText(russianLabels.regenerate)).toBeNull();
    expect(document.querySelector('[data-kind="branch-switcher"]')).toBeNull();
    expect(screen.queryByLabelText("модель")).toBeNull();
    expect(document.querySelector('[data-action="edit-answer"]')).toBeNull();
  });

  it("те же кнопки на месте, когда права разрешены", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.forks = forks;
    server.state.capabilities = allowed;
    await openChat(server, { skin: answerEditSkin, answerEditing: { edits: new Map(), renderEditor: () => null } });
    await screen.findByLabelText("модель");

    expect(document.querySelector('[data-action="edit"]')).not.toBeNull();
    expect(screen.queryByText(russianLabels.regenerate)).not.toBeNull();
    expect(document.querySelector('[data-kind="branch-switcher"]')).not.toBeNull();
    expect(document.querySelector('[data-action="edit-answer"]')).not.toBeNull();
  });

  it("«Повторить» — своё право: retry разрешён, regenerate нет — повтор оборванного ответа доступен", async () => {
    const server = fakeChatServer({ history: [question, interrupted] });
    server.state.capabilities = { ...allowed, regenerate: false };
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canRetry).toBe(true);
    expect(result.current.canRegenerate).toBe(false);
  });

  it("retry запрещён — «Повторить» у оборванного ответа нет", async () => {
    const server = fakeChatServer({ history: [question, interrupted] });
    server.state.capabilities = { ...allowed, retry: false };
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canRetry).toBe(false);
  });

  it("attachments и voice запрещены: скрепки и микрофона нет, хотя плагины подключены", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.capabilities = { ...allowed, attachments: false, voice: false };
    await openChat(server, { attachments: fakeAttachments(), voice: fakeVoice });
    await pause();

    expect(document.querySelector('[data-kind="composer-attachments"]')).toBeNull();
    expect(document.querySelector("[data-voice]")).toBeNull();
  });

  it("voice запрещён: голосовая отправка не уходит на сервер, как в закрытом чате", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.capabilities = { ...allowed, voice: false };
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.sendVoiceMessage("Голосовой вопрос")).toBe(false);
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(0);
  });

  it("voice разрешён: голосовая отправка уходит на сервер", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.capabilities = allowed;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.sendVoiceMessage("Голосовой вопрос")).toBe(true);
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
  });

  it("onChatAccessChange сообщает права и закрытие после загрузки", async () => {
    const onChatAccessChange = vi.fn();
    const server = fakeChatServer({ history: [question, answered] });
    server.state.capabilities = { ...allowed, chatList: false };
    server.state.closed = closure;
    await openChat(server, { onChatAccessChange });

    await waitFor(() => expect(onChatAccessChange).toHaveBeenLastCalledWith({ capabilities: { ...allowed, chatList: false }, closed: closure }));
  });
});

describe("закрытый чат на экране", () => {
  it("закрытие из истории: поле неактивно, над ним текст закрытия; «Повторить» нет; правка, «Переделать» и стрелки — по правам", async () => {
    const server = fakeChatServer({ history: [question, interrupted] });
    server.state.forks = forks;
    server.state.closed = closure;
    renderAgentChat(server);
    await screen.findByText("Здравствуйте");

    await waitFor(() => expect(composer().getAttribute("data-sending-blocked")).toBe("true"));
    expect(errorNotices()).toHaveLength(1);
    expect(errorNotices()[0]!.textContent).toContain(closure.message);
    expect(within(errorNotices()[0] as HTMLElement).queryByRole("button")).toBeNull();
    // Правка и ветки уводят с точки закрытия: закрыть их навсегда — правами приложения.
    expect(document.querySelector('[data-action="edit"]')).not.toBeNull();
    expect(document.querySelector('[data-kind="branch-switcher"]')).not.toBeNull();
    expect(document.querySelector('[data-kind="answer-retry"]')).toBeNull();

    fireEvent.change(field(), { target: { value: "Ещё вопрос" } });
    expect((screen.getByText("послать") as HTMLButtonElement).disabled).toBe(true);
  });

  it("хук: closed из истории, canSubmit и canRetry выключены, canEdit и canRegenerate — по правам; отправка не уходит", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.closed = closure;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.closed).toEqual(closure);
    act(() => result.current.setValue("Ещё вопрос"));
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.canRetry).toBe(false);
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canRegenerate).toBe(true);
    expect(result.current.sendReply("Ещё")).toBe(false);
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(0);
  });

  it("reloadKey сменился: история перечитывается, чат, открытый на сервере заново, снова принимает ходы", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.closed = closure;
    const { result, rerender } = renderHook(({ reloadKey }: { reloadKey: number }) => useAgentChat({ api: "/api/chat", chatId: "c1", fetch: server.fetch, reloadKey }), {
      initialProps: { reloadKey: 0 },
    });
    await waitFor(() => expect(result.current.closed).toEqual(closure));
    const reads = server.requestsTo("history").length;

    server.state.closed = undefined;
    rerender({ reloadKey: 0 });
    await pause();
    expect(server.requestsTo("history")).toHaveLength(reads);
    expect(result.current.closed).toEqual(closure);

    rerender({ reloadKey: 1 });
    await waitFor(() => expect(result.current.closed).toBeNull());
    expect(server.requestsTo("history")).toHaveLength(reads + 1);
  });

  it("скин договора 20: своя надпись ChatClosedNotice, поле ссылается на неё; ErrorNotice нет", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.closed = closure;
    renderAgentChat(server, { skin: closedNoticeSkin });
    await waitFor(() => expect(document.querySelector('[data-kind="chat-closed-notice"]')).not.toBeNull());
    const notice = document.querySelector('[data-kind="chat-closed-notice"]') as HTMLElement;

    expect(notice.textContent).toBe(closure.message);
    expect(notice.getAttribute("data-code")).toBe(closure.code);
    expect(field().getAttribute("aria-describedby")).toBe(notice.id);
    expect(errorNotices()).toHaveLength(0);
  });

  it("подтверждение и виджет в закрытом чате не активны", async () => {
    const probeSkin: ChatSkin = {
      ...stubSkin,
      Widget: (view: WidgetView) => <div data-kind="widget" data-active={String(view.kind === "choice" && view.onChoose !== undefined)} />,
    };
    const server = fakeChatServer({
      history: [
        question,
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "step-start" },
            { type: "tool-delete_notes", title: "Удалить заметки", toolCallId: "call-1", state: "approval-requested", input: {}, approval: { id: "ap1" } },
            { type: "tool-ask_choice", toolCallId: "w1", state: "input-available", input: { question: "Куда?", options: ["Море", "Горы"] } },
          ],
          metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
        },
      ],
    });
    server.state.closed = closure;
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(document.querySelector('[data-kind="widget"]')).toBeTruthy());

    expect(document.querySelector('[data-kind="widget"]')!.getAttribute("data-active")).toBe("false");
    expect(screen.queryByLabelText("allow")).toBeNull();
  });

  it("отказ 409 chat_closed на отправку: onTurnRefused, текст вернулся в поле, чат закрылся, надпись одна", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server, { onTurnRefused });

    server.state.refuse.messages = { status: 409, kind: "", body: { error: { kind: "chat_closed", ...closure } } };
    submitQuestion("Как дела?");

    await waitFor(() => expect(composer().getAttribute("data-sending-blocked")).toBe("true"));
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "chat_closed", ...closure });
    await waitFor(() => expect(field().value).toBe("Как дела?"));
    expect(errorNotices()).toHaveLength(1);
    expect(errorNotices()[0]!.textContent).toContain(closure.message);
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(1);
  });

  it("отказ 409 chat_closed на подтверждение: onTurnRefused, кнопки подтверждения пропали", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({
      history: [
        question,
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "step-start" }, { type: "tool-delete_notes", toolCallId: "call-1", state: "approval-requested", input: {}, approval: { id: "ap1" } }],
          metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
        },
      ],
    });
    server.state.approval = { status: 409, body: { error: { kind: "chat_closed", ...closure } } };
    renderAgentChat(server, { onTurnRefused });
    fireEvent.click(await screen.findByLabelText("allow"));

    await waitFor(() => expect(onTurnRefused).toHaveBeenCalledWith({ kind: "chat_closed", ...closure }));
    await waitFor(() => expect(screen.queryByLabelText("allow")).toBeNull());
  });

  it("отказ 403 action_forbidden на «Переделать»: текст отказа, onTurnRefused с правом в code", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({ history: [question, answered] });
    await openChat(server, { onTurnRefused });

    const forbidden = { kind: "action_forbidden", action: "regenerate", code: "regenerate", message: "Это действие в этом чате недоступно." };
    server.state.refuse.regenerate = { status: 403, kind: "", body: { error: forbidden } };
    fireEvent.click(screen.getByText(russianLabels.regenerate));

    await waitFor(() => expect(errorNotices()[0]?.textContent).toContain("Это действие в этом чате недоступно."));
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "action_forbidden", code: "regenerate", message: "Это действие в этом чате недоступно." });
    expect(composer().getAttribute("data-sending-blocked")).toBe("false");
  });

  it("после 403 action_forbidden права обновляются: сервер их сменил — запрещённое действие выключается", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.capabilities = allowed;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.capabilities.regenerate).toBe(true);

    // Права сменились на сервере, пока экран открыт: экран узнаёт об этом из отказа.
    server.state.capabilities = { ...allowed, regenerate: false };
    const forbidden = { kind: "action_forbidden", action: "regenerate", code: "regenerate", message: "Это действие в этом чате недоступно." };
    server.state.refuse.regenerate = { status: 403, kind: "", body: { error: forbidden } };
    await act(async () => {
      result.current.regenerate();
    });

    await waitFor(() => expect(result.current.capabilities.regenerate).toBe(false));
  });

  it("после 403 action_forbidden на правку права тоже обновляются", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.capabilities = allowed;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));

    server.state.capabilities = { ...allowed, edit: false };
    server.state.refuse.edit = { status: 403, kind: "", body: { error: { kind: "action_forbidden", action: "edit", code: "edit", message: "Это действие в этом чате недоступно." } } };
    await act(async () => {
      await result.current.edit("u1", "Добрый день");
    });

    await waitFor(() => expect(result.current.capabilities.edit).toBe(false));
    expect(result.current.canEdit).toBe(false);
  });

  it("после 403 action_forbidden на «Повторить» права тоже обновляются", async () => {
    const server = fakeChatServer({ history: [question, interrupted] });
    server.state.capabilities = allowed;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canRetry).toBe(true);

    server.state.capabilities = { ...allowed, retry: false };
    server.state.refuse.retry = { status: 403, kind: "", body: { error: { kind: "action_forbidden", action: "retry", code: "retry", message: "Это действие в этом чате недоступно." } } };
    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.capabilities.retry).toBe(false));
    expect(result.current.canRetry).toBe(false);
  });

  it("после 403 action_forbidden запрещённая кнопка пропадает с экрана и не возвращается", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.capabilities = allowed;
    await openChat(server);
    await screen.findByLabelText("модель");
    expect(screen.queryByText(russianLabels.regenerate)).not.toBeNull();

    server.state.capabilities = { ...allowed, regenerate: false };
    const forbidden = { kind: "action_forbidden", action: "regenerate", code: "regenerate", message: "Это действие в этом чате недоступно." };
    server.state.refuse.regenerate = { status: 403, kind: "", body: { error: forbidden } };
    fireEvent.click(screen.getByText(russianLabels.regenerate));

    await waitFor(() => expect(errorNotices()[0]?.textContent).toContain("Это действие в этом чате недоступно."));
    // Отказ — не обрыв отправки: «Переделать» пропадает именно из-за прав, а не из-за состояния сбоя.
    await pause();
    expect(screen.queryByText(russianLabels.regenerate)).toBeNull();
  });

  it("отказ action_forbidden на правку: исход несёт текст и код", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));

    server.state.refuse.edit = { status: 403, kind: "", body: { error: { kind: "action_forbidden", action: "edit", code: "edit", message: "Это действие в этом чате недоступно." } } };
    let outcome: Awaited<ReturnType<typeof result.current.edit>> | undefined;
    await act(async () => {
      outcome = await result.current.edit("u1", "Добрый день");
    });
    expect(outcome).toEqual({ status: "refused", reason: "server_refused", text: "Это действие в этом чате недоступно.", code: "edit" });
  });

  it("кусок data-chat-closed в потоке ответа закрывает чат, когда ответ дописан", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setValue("Отправляю форму"));
    act(() => void result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;
    stream.push({ type: "start", messageId: "a2" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Заявка принята" });
    stream.push({ type: "data-chat-closed", data: closure, transient: true });
    stream.finish();

    await waitFor(() => expect(result.current.closed).toEqual(closure));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.messages.at(-1)!.parts.some((part) => part.type === "data-chat-closed")).toBe(false);
  });

  it("события наблюдения: chat-closed закрывает вкладку живьём, chat-reopened открывает", async () => {
    const server = fakeChatServer({ history: [question, answered] });
    server.state.watch = true;
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));

    act(() => server.emit({ type: "chat-closed", ownerId: "u", chatId: "c1", closed: closure }));
    await waitFor(() => expect(result.current.closed).toEqual(closure));

    act(() => server.emit({ type: "chat-reopened", ownerId: "u", chatId: "c1" }));
    await waitFor(() => expect(result.current.closed).toBeNull());
  });
});

describe("договор скина, версия 20", () => {
  type ClosedNoticeProps = NonNullable<ChatSkin["ChatClosedNotice"]> extends ComponentType<infer P> ? P : never;

  it("ChatClosedNotice — необязательный компонент { id, code, message }; скин версии 19 работает без правок", () => {
    expectTypeOf<ClosedNoticeProps>().toEqualTypeOf<{ id: string; code: string; message: string }>();
    const v19: ChatSkin = { ...stubSkin };
    expect(v19.ChatClosedNotice).toBeUndefined();
  });
});

describe("ChatWorkspace и право chatList", () => {
  /** Следит за DOM с первой отрисовки: появлялся ли список хоть на один кадр, даже если его тут же убрали. */
  function watchChatList() {
    let appeared = false;
    const isList = (node: Node) => node instanceof Element && (node.matches('[data-testid="chat-list"]') || node.querySelector('[data-testid="chat-list"]') !== null);
    const observer = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes].some(isList))) appeared = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return {
      appeared: () => {
        if (observer.takeRecords().some((record) => [...record.addedNodes].some(isList))) appeared = true;
        return appeared;
      },
      stop: () => observer.disconnect(),
    };
  }

  function openWorkspace(capabilities: Record<string, boolean> | undefined, props: Partial<Parameters<typeof ChatWorkspace>[0]> = {}) {
    localStorage.clear();
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    server.chatServer.state.history = [question, answered];
    server.chatServer.state.capabilities = capabilities;
    vi.stubGlobal("fetch", server.fetch);
    render(<ChatWorkspace api="/api/chat" skin={stubWorkspaceSkin} {...props} />);
    return server;
  }

  it("chatList запрещён у открытого чата — списка нет, чат открыт и не перезагружается", async () => {
    const server = openWorkspace({ ...allowed, chatList: false });
    await screen.findByText("Здравствуйте");

    await waitFor(() => expect(screen.queryByTestId("chat-list")).toBeNull());
    await pause();
    expect(screen.getByText("Здравствуйте")).toBeTruthy();
    expect(server.requests.filter((request) => request.method === "GET" && request.path === "/api/chat/c1")).toHaveLength(1);
  });

  it("chatList запрещён: список ни разу не появлялся в DOM, даже на один кадр", async () => {
    const watcher = watchChatList();
    openWorkspace({ ...allowed, chatList: false });
    await screen.findByText("Здравствуйте");
    await pause();

    expect(watcher.appeared()).toBe(false);
    watcher.stop();
  });

  it("chatList запрещён: после первого запроса (он ищет открытый чат) список чатов больше не запрашивается, даже когда ответ начался и кончился", async () => {
    const server = openWorkspace({ ...allowed, chatList: false });
    await screen.findByText("Здравствуйте");
    await pause();
    const listGets = () => server.listRequests("GET").length;
    const before = listGets();

    submitQuestion("Ещё вопрос");
    await waitFor(() => expect(server.chatServer.streams).toHaveLength(1));
    server.chatServer.streams[0]!.answer("Ответ");
    await screen.findByText("Ответ");
    await pause(150);

    expect(listGets()).toBe(before);
  });

  it("chatList разрешён: список появляется после первой истории и остаётся", async () => {
    openWorkspace({ ...allowed, chatList: true });
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(screen.getByTestId("chat-list")).toBeTruthy());
  });

  it("сервер до 0.27 (прав нет): список появляется, как раньше", async () => {
    openWorkspace(undefined);
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(screen.getByTestId("chat-list")).toBeTruthy());
  });

  it("чата нет («Чат не найден») или история не загрузилась: список показан, чтобы выбрать другой чат", async () => {
    openWorkspace({ ...allowed, chatList: false }, { initialChatId: "нет-такого" });
    await waitFor(() => expect(screen.getByTestId("chat-list")).toBeTruthy());
  });

  it("сбой истории: список показан, чтобы выбрать другой чат", async () => {
    localStorage.clear();
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    server.chatServer.state.fail.add("history");
    vi.stubGlobal("fetch", server.fetch);
    render(<ChatWorkspace api="/api/chat" skin={stubWorkspaceSkin} />);
    await waitFor(() => expect(screen.getByTestId("chat-list")).toBeTruthy());
  });

  it("выбор другого чата в списке: список не пропадает, пока новый чат грузится", async () => {
    localStorage.clear();
    const server = fakeChatListServer([
      { id: "c2", title: "Второй" },
      { id: "c1", title: "Первый" },
    ]);
    server.chatServer.state.history = [question, answered];
    vi.stubGlobal("fetch", server.fetch);
    render(<ChatWorkspace api="/api/chat" skin={stubWorkspaceSkin} />);
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(screen.getByTestId("chat-list")).toBeTruthy());

    let disappeared = false;
    const observer = new MutationObserver((records) => {
      if (records.some((record) => [...record.removedNodes].some((node) => node instanceof Element && node.querySelector('[data-testid="chat-list"]') !== null))) disappeared = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    fireEvent.click(within(screen.getByTestId("chat-list")).getByText("Первый"));
    await pause();
    observer.disconnect();
    expect(disappeared).toBe(false);
    expect(screen.getByTestId("chat-list")).toBeTruthy();
  });
});
