// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { russianLabels } from "@ykurilov/agent-chat-react";
import { stubChatListSkin } from "../../../react/tests/support/stub-chat-list-skin";
import { setupChatDom } from "../../../react/tests/support/chat-dom";
import type { HistoryMessage } from "../../../react/tests/support/fake-chat-server";
import { AgentSandbox } from "../../src/react";
import { MAX_INSTRUCTIONS_LENGTH } from "../../src/react/instruction-header";
import type { JournalCallResponse, JournalListResponse } from "../../src/types";
import { fakeSandboxServer } from "./support/fake-sandbox-server";
import { stubSandboxChatSkin, stubSandboxSkin } from "./support/stub-sandbox-skin";

setupChatDom();
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

type Entry = JournalListResponse["entries"][number];

const question = (id: string, text: string): HistoryMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string, parts: HistoryMessage["parts"] = []): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [...parts, { type: "text", text, state: "done" }],
  metadata: { status: "complete" },
});
const model = (id: string, messageId: string): Entry => ({
  kind: "model", id, chatId: "c1", ownerId: "sandbox:u", messageId, purpose: "answer", attempt: 1, modelId: `model-${id}`, providerId: "p",
  usage: { inputTokens: 10, cachedInputTokens: 2, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 0 }, costUsd: 0.001,
  startedAt: "2026-10-03T10:00:00.000Z", firstChunkMs: 100, durationMs: 300, status: "complete", error: null, instructionsChanged: false,
});
const blob = (hash: string, content: unknown) => ({ hash, content, bytes: 1, truncated: false });
const modelCall = (id: string, messageHashes: string[]): JournalCallResponse =>
  ({
    kind: "model",
    call: { ...model(id, "a1"), instructionsHash: "ins", messageHashes, toolsHash: "t", settingsHash: "s", responseHash: "r" },
    instructions: blob("ins", "Инструкция"),
    messages: messageHashes.map((hash) => blob(hash, { role: "user", content: `сообщение ${hash}` })),
    tools: blob("t", []),
    settings: blob("s", {}),
    response: blob("r", { text: "Ответ", reasoning: "", toolCalls: [], finishReason: "stop" }),
  }) as JournalCallResponse;

function renderSandbox(server: ReturnType<typeof fakeSandboxServer>) {
  vi.stubGlobal("fetch", server.fetch);
  return render(<AgentSandbox skin={stubSandboxChatSkin} sandboxSkin={stubSandboxSkin} chatListSkin={stubChatListSkin} />);
}

const journal = () => screen.getByTestId("journal");
/** Кнопка правки ответа, когда история загрузилась. */
const editAnswerButton = () =>
  waitFor(() => {
    const button = document.querySelector<HTMLElement>('[data-action="edit-answer"]');
    if (!button) throw new Error("кнопки правки ещё нет");
    return button;
  });
const rowIds = () => [...journal().querySelectorAll("[data-row]")].map((row) => row.getAttribute("data-row"));

describe("AgentSandbox", () => {
  it("создаёт песочный чат через адреса basePath и открывает его с инструкцией и журналом", async () => {
    const server = fakeSandboxServer([]);
    renderSandbox(server);
    fireEvent.click(within(await screen.findByTestId("chat-list")).getAllByText(russianLabels.chatListNewChat)[0]!);
    await screen.findByLabelText("поле");
    expect(server.chatServer.requests.some((request) => request.method === "POST" && request.path === "/api/sandbox")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("instructions").getAttribute("data-app")).toBe("Боевая инструкция"));
    expect(server.requestsTo("/chats/new-1/settings")).toHaveLength(1);
    await waitFor(() => expect(journal().getAttribute("data-state")).toBe("empty"));
  });

  it("журнал: ход выбирается, строка раскрывается и грузит подробности с подсветкой новых сообщений", async () => {
    const server = fakeSandboxServer();
    server.chatServer.chatServer.state.history = [question("u1", "Привет"), answer("a1", "Один"), question("u2", "Ещё"), answer("a2", "Два")];
    server.state.entries = [model("m1", "a1"), model("m2", "a2")];
    server.state.calls = { m1: modelCall("m1", ["h1"]), m2: modelCall("m2", ["h1", "h2"]) };
    renderSandbox(server);
    await waitFor(() => expect(rowIds()).toEqual(["m1", "m2"]));

    fireEvent.change(within(journal()).getByLabelText("ход"), { target: { value: "a2" } });
    expect(rowIds()).toEqual(["m2"]);

    fireEvent.click(within(journal()).getByText("model-m2"));
    await waitFor(() => expect(screen.getByTestId("model-details").getAttribute("data-state")).toBe("ready"));
    expect([...screen.getByTestId("model-details").querySelectorAll("p")].map((p) => p.getAttribute("data-new"))).toEqual(["false", "true"]);
    expect(server.requestsTo("/journal/calls/m1")).toHaveLength(1);
  });

  it("журнал перечитывается после конца хода", async () => {
    const server = fakeSandboxServer();
    renderSandbox(server);
    await waitFor(() => expect(journal().getAttribute("data-state")).toBe("empty"));
    const before = server.requestsTo("/journal").length;
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Привет" } });
    fireEvent.submit(screen.getByLabelText("поле").closest("form")!);
    await waitFor(() => expect(server.chatServer.chatServer.streams).toHaveLength(1));
    server.state.entries = [model("m1", "a1")];
    await act(async () => {
      server.chatServer.chatServer.streams[0]!.answer("Ответ");
    });
    await waitFor(() => expect(rowIds()).toEqual(["m1"]));
    expect(server.requestsTo("/journal").length).toBeGreaterThan(before);
  });

  it("инструкция длиннее предела: сохранить нельзя, видна ошибка, возврат к пределу снова разрешает", async () => {
    const server = fakeSandboxServer();
    renderSandbox(server);
    const field = await screen.findByLabelText("инструкция");
    const save = () => document.querySelector('[data-action="save-instructions"]') as HTMLButtonElement;
    fireEvent.change(field, { target: { value: "а".repeat(MAX_INSTRUCTIONS_LENGTH + 1) } });
    expect(save().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain(String(MAX_INSTRUCTIONS_LENGTH));
    fireEvent.change(field, { target: { value: "а".repeat(MAX_INSTRUCTIONS_LENGTH) } });
    expect(save().disabled).toBe(false);
  });

  it("инструкция: правка сохраняется PUT, отметка «изменена», «вернуть боевую» шлёт null", async () => {
    const server = fakeSandboxServer();
    renderSandbox(server);
    const field = await screen.findByLabelText("инструкция");
    expect((field as HTMLTextAreaElement).value).toBe("Боевая инструкция");
    fireEvent.change(field, { target: { value: "Отвечай стихами" } });
    expect(screen.getByTestId("instructions").getAttribute("data-dirty")).toBe("true");
    fireEvent.click(document.querySelector('[data-action="save-instructions"]')!);
    await waitFor(() => expect(screen.getByTestId("instructions").getAttribute("data-edited")).toBe("true"));
    expect(server.requestsTo("/chats/c1/settings").at(-1)).toMatchObject({ method: "PUT", body: { instructions: "Отвечай стихами" } });

    fireEvent.click(document.querySelector('[data-action="reset-instructions"]')!);
    await waitFor(() => expect(screen.getByTestId("instructions").getAttribute("data-edited")).toBe("false"));
    expect(server.requestsTo("/chats/c1/settings").at(-1)).toMatchObject({ method: "PUT", body: { instructions: null } });
    expect((screen.getByLabelText("инструкция") as HTMLTextAreaElement).value).toBe("Боевая инструкция");
  });

  it("правка ответа: редактор с JSON результата, запрос с изменённым, новая ветка и отметки", async () => {
    const server = fakeSandboxServer();
    const toolPart = { type: "tool-search", toolCallId: "s1", state: "output-available", input: {}, output: { found: 1 } } as unknown as HistoryMessage["parts"][number];
    server.chatServer.chatServer.state.history = [question("u1", "Привет"), answer("a1", "Старый", [toolPart])];
    server.chatServer.chatServer.state.branchTo = {
      a2: {
        messages: [question("u1", "Привет"), answer("a2", "Новый", [{ ...toolPart, output: { found: 2 } } as HistoryMessage["parts"][number]])],
        forks: [{ messageId: "a2", siblingIds: ["a1", "a2"] }],
      },
    };
    server.state.editResult = { messageId: "a2", mark: { textEdited: true, editedToolCallIds: ["s1"] } };
    renderSandbox(server);
    fireEvent.click(await editAnswerButton());
    const editor = screen.getByTestId("answer-editor");
    expect((within(editor).getByLabelText("текст ответа") as HTMLTextAreaElement).value).toBe("Старый");

    fireEvent.change(within(editor).getByLabelText("результат s1"), { target: { value: "{ нет" } });
    expect(editor.querySelector("[data-error]")?.textContent).toBe("Неверный JSON");
    expect((editor.querySelector('[data-action="save-answer"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(editor).getByLabelText("результат s1"), { target: { value: '{"found":2}' } });
    fireEvent.change(within(editor).getByLabelText("текст ответа"), { target: { value: "Новый" } });
    fireEvent.click(editor.querySelector('[data-action="save-answer"]')!);

    await screen.findByText("Новый");
    expect(server.requestsTo("/chats/c1/messages/a1/answer-edit")[0]?.body).toEqual({ text: "Новый", toolOutputs: { s1: { found: 2 } } });
    expect(screen.queryByTestId("answer-editor")).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-edited")).toBe("true"));
    await waitFor(() => expect(journal().querySelector('[data-row="message:s1"]')?.getAttribute("data-output-edited")).toBe("true"));
  });

  it("правка ответа не сохранилась — ошибка, черновик на месте", async () => {
    const server = fakeSandboxServer();
    server.chatServer.chatServer.state.history = [question("u1", "Привет"), answer("a1", "Старый")];
    server.state.editFails = true;
    renderSandbox(server);
    fireEvent.click(await editAnswerButton());
    fireEvent.change(screen.getByLabelText("текст ответа"), { target: { value: "Новый" } });
    fireEvent.click(document.querySelector('[data-action="save-answer"]')!);
    expect((await screen.findByRole("alert")).textContent).toBe("Правка не сохранилась");
    expect((screen.getByLabelText("текст ответа") as HTMLTextAreaElement).value).toBe("Новый");
  });
});

describe("AgentSandbox: закрытый чат", () => {
  const closure = { code: "form_submitted", message: "Заявка отправлена, чат закрыт" };
  const reopenButton = () => screen.queryByRole("button", { name: "Открыть чат снова" });
  const composer = () => screen.getByLabelText("поле").closest("form")!;

  function closedChatServer() {
    const server = fakeSandboxServer();
    server.chatServer.chatServer.state.history = [question("u1", "Привет"), answer("a1", "Здравствуйте")];
    server.chatServer.chatServer.state.closed = closure;
    return server;
  }

  it("чат закрыт: кнопка «Открыть чат снова» видна, поле неактивно; нажатие зовёт reopen, кнопка пропадает, поле снова доступно", async () => {
    const server = closedChatServer();
    renderSandbox(server);
    await waitFor(() => expect(reopenButton()).not.toBeNull());
    await waitFor(() => expect(composer().getAttribute("data-sending-blocked")).toBe("true"));

    fireEvent.click(reopenButton()!);
    await waitFor(() => expect(server.requestsTo("/chats/c1/reopen")).toHaveLength(1));
    expect(server.requestsTo("/chats/c1/reopen")[0]!.method).toBe("POST");
    await waitFor(() => expect(reopenButton()).toBeNull());
    await waitFor(() => expect(composer().getAttribute("data-sending-blocked")).toBe("false"));
    expect((screen.getByText("послать") as HTMLButtonElement).disabled).toBe(true); // поле пусто, но заблокированности нет
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Продолжаем" } });
    expect((screen.getByText("послать") as HTMLButtonElement).disabled).toBe(false);
  });

  it("чат открыт: кнопки нет", async () => {
    const server = fakeSandboxServer();
    server.chatServer.chatServer.state.history = [question("u1", "Привет"), answer("a1", "Здравствуйте")];
    renderSandbox(server);
    await screen.findAllByText("Здравствуйте");
    await waitFor(() => expect(screen.getByTestId("instructions")).toBeTruthy());
    expect(reopenButton()).toBeNull();
  });

  it("reopen не удался: кнопка остаётся, ошибка видна, чат закрыт, нажать можно снова", async () => {
    const server = closedChatServer();
    server.state.reopenFails = true;
    renderSandbox(server);
    await waitFor(() => expect(reopenButton()).not.toBeNull());

    fireEvent.click(reopenButton()!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Чат не открылся"));
    expect(reopenButton()).not.toBeNull();
    expect((reopenButton() as HTMLButtonElement).disabled).toBe(false);
    expect(composer().getAttribute("data-sending-blocked")).toBe("true");

    server.state.reopenFails = false;
    fireEvent.click(reopenButton()!);
    await waitFor(() => expect(reopenButton()).toBeNull());
  });

  it("скин песочницы может нарисовать кнопку сам (ChatReopen)", async () => {
    const server = closedChatServer();
    vi.stubGlobal("fetch", server.fetch);
    const onReopen = vi.fn();
    const skin = {
      ...stubSandboxSkin,
      ChatReopen: (props: { onReopen: () => void; pending: boolean; error?: string }) => (
        <button type="button" data-testid="skin-reopen" data-pending={String(props.pending)} onClick={() => { onReopen(); props.onReopen(); }}>
          своя кнопка
        </button>
      ),
    };
    render(<AgentSandbox skin={stubSandboxChatSkin} sandboxSkin={skin} chatListSkin={stubChatListSkin} />);
    fireEvent.click(await screen.findByTestId("skin-reopen"));
    expect(onReopen).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByTestId("skin-reopen")).toBeNull());
    expect(reopenButton()).toBeNull();
  });
});
