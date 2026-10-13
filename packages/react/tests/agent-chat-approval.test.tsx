// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { russianLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom, submitQuestion } from "./support/chat-dom";

setupChatDom();

const waiting = (overrides: Record<string, unknown> = {}): HistoryMessage[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Удали заметки" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-delete_notes",
        title: "Удалить заметки",
        toolCallId: "call-1",
        state: "approval-requested",
        input: { folder: "старое" },
        approval: { id: "ap1", requestReason: "always-offered" },
        ...overrides,
      },
    ],
    metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
  },
];

const row = () => document.querySelector('[data-kind="tool"]') as HTMLElement;
const decide = (decision: "allow" | "deny" | "always") => fireEvent.click(screen.getByLabelText(decision));

/** Продолжение ответа, как его шлёт сервер: тот же id сообщения, результат инструмента, текст, итог. */
function continueAnswer(stream: { push: (chunk: Record<string, unknown>) => void; end: () => void }, output: "ok" | "denied") {
  stream.push({ type: "start", messageId: "a1", messageMetadata: { modelId: "m", providerId: "p" } });
  stream.push(output === "ok" ? { type: "tool-output-available", toolCallId: "call-1", output: "удалено 3" } : { type: "tool-output-denied", toolCallId: "call-1" });
  stream.push({ type: "start-step" });
  stream.push({ type: "text-start", id: "t" });
  stream.push({ type: "text-delta", id: "t", delta: "Готово" });
  stream.push({ type: "text-end", id: "t" });
  stream.push({ type: "message-metadata", messageMetadata: { status: "complete" } });
  stream.push({ type: "finish" });
  stream.end();
}

describe("AgentChat: подтверждение действий", () => {
  it("ответ, ждущий решения, из истории: карточка с названием и кнопками, ответ не «пустой», поле ввода доступно", async () => {
    const server = fakeChatServer({ history: waiting() });
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    expect(row().getAttribute("data-title")).toBe("Удалить заметки");
    expect(row().getAttribute("data-approval")).toBe("requested");
    expect(row().getAttribute("data-approval-pending")).toBe("false");
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-empty")).toBe("false");
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-status")).toBe("awaiting_approval");
    expect(document.querySelector('[data-kind="answer-retry"]')).toBeNull();
    const field = screen.getByLabelText("поле") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "лучше не надо" } });
    expect((document.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("«Разрешить»: запрос на сервер, подключение к продолжению, результат и текст в том же сообщении", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("allow");
    await waitFor(() => expect(server.requestsTo("approval")).toHaveLength(1));
    expect(server.requestsTo("approval")[0]).toMatchObject({ method: "POST", body: { decision: "allow" } });
    expect(server.requestsTo("approval")[0]!.url).toMatch(/\/api\/chat\/c1\/approvals\/ap1$/);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    continueAnswer(server.resumed[0]!, "ok");
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("Готово"));
    expect(document.querySelectorAll('[data-kind="agent"]')).toHaveLength(1);
    expect(row().getAttribute("data-state")).toBe("done");
    expect(row().getAttribute("data-approval")).toBe("allowed");
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-status")).toBe("complete");
  });

  it("«Отклонить»: строка помечена отклонённой, ход продолжается", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("deny");
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    expect(server.requestsTo("approval")[0]).toMatchObject({ body: { decision: "deny" } });
    continueAnswer(server.resumed[0]!, "denied");
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("Готово"));
    expect(row().getAttribute("data-approval")).toBe("denied");
  });

  it("«Всегда в этом чате»: решение уходит с пометкой и остаётся видимым", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("always");
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    expect(server.requestsTo("approval")[0]).toMatchObject({ body: { decision: "always" } });
    expect(row().getAttribute("data-approval")).toBe("always");
    continueAnswer(server.resumed[0]!, "ok");
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')).toBeTruthy());
    expect(row().getAttribute("data-approval")).toBe("always");
  });

  it("пока запрос летит, кнопки заняты", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    server.state.hang.add("approval");
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("allow");
    await waitFor(() => expect(row().getAttribute("data-approval-pending")).toBe("true"));
  });

  it("другие запросы ещё ждут (resumed: false): продолжения нет, решение отмечено", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    server.state.approval = { status: 200, body: { resumed: false } };
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("allow");
    await waitFor(() => expect(row().getAttribute("data-approval")).toBe("allowed"));
    expect(server.resumed).toHaveLength(0);
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-status")).toBe("awaiting_approval");
  });

  it("сервер отвечает 409 (решили на другом устройстве): история перечитывается и показывается как есть", async () => {
    const server = fakeChatServer({ history: waiting() });
    server.state.approval = { status: 409, body: { error: { kind: "approval_not_pending" } } };
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    server.state.history = [
      waiting()[0]!,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "tool-delete_notes", toolCallId: "call-1", state: "output-denied", input: {}, approval: { id: "ap1", approved: false, reason: "нет" } },
          { type: "text", text: "Понял, не удаляю", state: "done" },
        ],
        metadata: { status: "complete", reasoningDurationsMs: {} },
      },
    ];
    decide("allow");
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("Понял, не удаляю"));
    expect(row().getAttribute("data-approval")).toBe("denied");
  });

  it("запрос не дошёл до сервера: карточка возвращается с пометкой «не вышло»", async () => {
    const server = fakeChatServer({ history: waiting() });
    server.state.fail.add("approval");
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("allow");
    await waitFor(() => expect(row().getAttribute("data-approval-failed")).toBe("true"));
    expect(row().getAttribute("data-approval")).toBe("requested");
    expect(row().getAttribute("data-approval-pending")).toBe("false");
    expect(server.resumed).toHaveLength(0);
  });

  it("живой ход: запрос приходит потоком, ход заканчивается ожиданием, поле ввода не занято", async () => {
    const server = fakeChatServer();
    renderAgentChat(server);
    await screen.findByLabelText("поле");
    submitQuestion("Удали заметки");
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "start-step" });
    stream.push({ type: "tool-input-available", toolCallId: "call-1", toolName: "delete_notes", input: { folder: "старое" } });
    stream.push({ type: "tool-approval-request", approvalId: "ap1", toolCallId: "call-1" });
    stream.push({ type: "finish-step" });
    stream.push({ type: "message-metadata", messageMetadata: { status: "awaiting_approval" } });
    stream.push({ type: "finish" });
    act(() => stream.end());
    await waitFor(() => expect(row()?.getAttribute("data-approval")).toBe("requested"));
    await waitFor(() => expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-status")).toBe("awaiting_approval"));
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "ещё" } });
    expect((document.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("решённые ответы из истории показывают итог решения без кнопок", async () => {
    const history: HistoryMessage[] = [
      waiting()[0]!,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "tool-delete_notes", toolCallId: "call-1", state: "output-available", input: {}, output: "ок", approval: { id: "ap1", approved: true, reason: "always-in-chat" } },
          { type: "tool-delete_notes", toolCallId: "call-2", state: "output-available", input: {}, output: "ок", approval: { id: "ap2", approved: true } },
          { type: "tool-read_notes", toolCallId: "call-3", state: "output-available", input: {}, output: "ок" },
        ],
        metadata: { status: "complete", reasoningDurationsMs: {} },
      },
    ];
    renderAgentChat(fakeChatServer({ history }));
    await waitFor(() => expect(row()).toBeTruthy());
    const rows = [...document.querySelectorAll('[data-kind="tool"]')].map((element) => element.getAttribute("data-approval"));
    expect(rows).toEqual(["always", "allowed", ""]);
    expect(screen.queryByLabelText("allow")).toBeNull();
  });

  it("страница открыта посреди продолжения (решение принято на другом устройстве): ответ дописывается в то же сообщение", async () => {
    const history = waiting({ state: "approval-responded", approval: { id: "ap1", approved: true } });
    const server = fakeChatServer({ history, running: true, resumable: true });
    renderAgentChat(server);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    continueAnswer(server.resumed[0]!, "ok");
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("Готово"));
    expect(document.querySelectorAll('[data-kind="agent"]')).toHaveLength(1);
    expect(row().getAttribute("data-state")).toBe("done");
  });

  it("«Всегда» есть, только если сервер её предложил: у запроса без метки кнопки нет", async () => {
    const server = fakeChatServer({ history: waiting({ approval: { id: "ap1" } }) });
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    expect(row().getAttribute("data-approval-can-always")).toBe("false");
    expect(screen.queryByLabelText("always")).toBeNull();
    expect(screen.getByLabelText("allow")).toBeTruthy();
  });

  it("«Всегда» видна у запроса с меткой сервера", async () => {
    renderAgentChat(fakeChatServer({ history: waiting() }));
    await waitFor(() => expect(row()).toBeTruthy());
    expect(row().getAttribute("data-approval-can-always")).toBe("true");
    expect(screen.getByLabelText("always")).toBeTruthy();
  });

  it("новое сообщение отклонено сервером (409 «занят»): карточка возвращается к кнопкам", async () => {
    const server = fakeChatServer({ history: waiting() });
    server.state.refuse.messages = { status: 409, kind: "busy" };
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    submitQuestion("лучше не надо");
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
    await waitFor(() => expect(row().getAttribute("data-approval")).toBe("requested"));
    expect(screen.getByLabelText("allow")).toBeTruthy();
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-status")).toBe("awaiting_approval");
  });

  it("новое сообщение не принято (400): карточка возвращается к кнопкам, текст — в поле", async () => {
    const server = fakeChatServer({ history: waiting() });
    server.state.refuse.messages = { status: 400, kind: "invalid" };
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    submitQuestion("лучше не надо");
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
    await waitFor(() => expect(row().getAttribute("data-approval")).toBe("requested"));
    expect((screen.getByLabelText("поле") as HTMLTextAreaElement).value).toBe("лучше не надо");
  });

  it("лимит расходов на «Разрешить» (429): понятная надпись, карточка остаётся с кнопками", async () => {
    const server = fakeChatServer({ history: waiting() });
    server.state.approval = { status: 429, body: { error: { kind: "spending_limit_reached", scope: "user", period: "month", resetsAt: null } } };
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("allow");
    await waitFor(() => expect(row().getAttribute("data-approval-failed")).toBe("true"));
    expect(row().getAttribute("data-approval")).toBe("requested");
    expect(row().getAttribute("data-approval-failure")).toBe("Лимит расходов исчерпан, ответить сейчас нельзя");
    expect(screen.getByLabelText("allow")).toBeTruthy();
    expect(server.resumed).toHaveLength(0);
  });

  it("у человека уже идут ответы в других чатах (429 too_many_turns) на «Разрешить»: своя надпись, карточка остаётся с кнопками", async () => {
    const server = fakeChatServer({ history: waiting() });
    server.state.approval = { status: 429, body: { error: { kind: "too_many_turns", limit: 3 } } };
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("allow");
    await waitFor(() => expect(row().getAttribute("data-approval-failed")).toBe("true"));
    expect(row().getAttribute("data-approval-failure")).toBe(russianLabels.approvalTooManyTurns);
    expect(screen.getByLabelText("allow")).toBeTruthy();
    expect(server.resumed).toHaveLength(0);
  });

  it("чат занят (409 «busy») на «Разрешить»: надпись про занятость, карточка остаётся, история не перечитывается", async () => {
    const server = fakeChatServer({ history: waiting() });
    server.state.approval = { status: 409, body: { error: { kind: "busy" } } };
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    const historyBefore = server.requestsTo("history").length;
    decide("allow");
    await waitFor(() => expect(row().getAttribute("data-approval-failed")).toBe("true"));
    expect(row().getAttribute("data-approval-failure")).toBe("Чат занят другим ходом, попробуйте ещё раз");
    expect(server.requestsTo("history")).toHaveLength(historyBefore);
  });

  it("продолжение оборвалось «стопом», у вызова нет результата: вызов не висит «в пути», лента берёт правду с сервера", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    renderAgentChat(server);
    await waitFor(() => expect(row()).toBeTruthy());
    decide("allow");
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    const closed: HistoryMessage[] = [
      waiting()[0]!,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "tool-delete_notes", toolCallId: "call-1", state: "output-denied", input: {}, approval: { id: "ap1", approved: false, reason: "прервано" } },
        ],
        metadata: { status: "stopped", reasoningDurationsMs: {} },
      },
    ];
    server.state.history = closed;
    const stream = server.resumed[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "message-metadata", messageMetadata: { status: "stopped" } });
    stream.push({ type: "abort" });
    act(() => stream.end());
    await waitFor(() => expect(row().getAttribute("data-state")).toBe("error"));
    expect(row().getAttribute("data-approval")).toBe("denied");
  });
});
