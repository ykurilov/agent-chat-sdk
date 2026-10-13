// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatSkin, WidgetView } from "../src/skin-contract";
import { createAppBridge } from "../src/app-bridge/create-app-bridge";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, renderChatHook, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

/**
 * Сервер ответил, что ответа или вопроса уже нет (виджет не ждёт, решение уже принято, хода больше нет): лента сразу
 * перечитывает историю. Под нагрузкой первое чтение истории может сорваться — лента не застывает, а читает снова.
 */

const liveness = { reconnectDelaysMs: [0, 30, 30, 30, 30] };

const ProbeWidget = (view: WidgetView) => (
  <div data-kind="widget" data-active={String(view.active)} data-by-message={String(view.answeredByMessage)}>
    {view.kind === "choice" &&
      view.options.map((option) => (
        <button key={option} type="button" disabled={!view.onChoose || view.pending} onClick={() => view.onChoose?.(option)}>
          {option}
        </button>
      ))}
  </div>
);
const probeSkin: ChatSkin = { ...stubSkin, Widget: ProbeWidget };
const widget = () => document.querySelector('[data-kind="widget"]') as HTMLElement;

const question = { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Когда удобно?" }] };
const choicePart = (overrides: Record<string, unknown> = {}) => ({
  type: "tool-ask_choice",
  toolCallId: "w1",
  state: "input-available",
  input: { question: "Время?", options: ["10:00", "12:00"] },
  ...overrides,
});
const waitingWidget = (part: Record<string, unknown> = choicePart(), status = "awaiting_approval"): HistoryMessage[] => [
  question,
  { id: "a1", role: "assistant", parts: [{ type: "step-start" }, part], metadata: { status, reasoningDurationsMs: {} } },
];
const finishedAfterWidget: HistoryMessage[] = [
  question,
  {
    id: "a1",
    role: "assistant",
    parts: [{ type: "step-start" }, choicePart({ state: "output-available", output: { "выбрано": "10:00" } }), { type: "text", text: "Записал на 10:00", state: "done" }],
    metadata: { status: "complete", reasoningDurationsMs: {} },
  },
];

/** Следующее чтение истории сорвётся (500); дальнейшие проходят. */
async function failNextHistoryRead(server: ReturnType<typeof fakeChatServer>) {
  const before = server.requestsTo("history").length;
  server.state.fail.add("history");
  await waitFor(() => expect(server.requestsTo("history").length).toBeGreaterThan(before));
  server.state.fail.delete("history");
}

describe("ответа уже нет: лента перечитывает историю", () => {
  it("виджет: 409 widget_not_pending и сорвавшееся чтение истории — лента читает снова и показывает правду сервера", async () => {
    const server = fakeChatServer({ history: waitingWidget() });
    server.state.widget = { status: 409, body: { error: { kind: "widget_not_pending" } } };
    renderAgentChat(server, { skin: probeSkin, liveness });
    await waitFor(() => expect(widget()).toBeTruthy());
    server.state.history = finishedAfterWidget;
    fireEvent.click(screen.getByText("10:00"));
    await failNextHistoryRead(server);
    await waitFor(() => expect(screen.getByText("Записал на 10:00")).toBeTruthy());
    expect(widget().getAttribute("data-active")).toBe("false");
  });

  it("виджет: ответ принят, а продолжения уже нет (204) и чтение истории сорвалось — лента читает снова", async () => {
    const server = fakeChatServer({ history: waitingWidget() });
    renderAgentChat(server, { skin: probeSkin, liveness });
    await waitFor(() => expect(widget()).toBeTruthy());
    server.state.history = finishedAfterWidget;
    server.state.widget.beforeReply = () => server.state.fail.add("history");
    fireEvent.click(screen.getByText("10:00"));
    await waitFor(() => expect(server.requestsTo("stream").length).toBeGreaterThan(0));
    await waitFor(() => expect(server.requestsTo("history").length).toBeGreaterThan(1));
    server.state.fail.delete("history");
    await waitFor(() => expect(screen.getByText("Записал на 10:00")).toBeTruthy());
  });

  it("подтверждение: 409 approval_not_pending и сорвавшееся чтение истории — лента читает снова", async () => {
    const asked: HistoryMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Удали заметки" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "step-start" }, { type: "tool-delete_notes", toolCallId: "call-1", state: "approval-requested", input: {}, approval: { id: "ap1" } }],
        metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
      },
    ];
    const server = fakeChatServer({ history: asked });
    server.state.approval = { status: 409, body: { error: { kind: "approval_not_pending" } } };
    renderAgentChat(server, { liveness });
    await waitFor(() => expect(document.querySelector('[data-kind="tool"]')).toBeTruthy());
    server.state.history = [
      asked[0]!,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "tool-delete_notes", toolCallId: "call-1", state: "output-denied", input: {}, approval: { id: "ap1", approved: false } },
          { type: "text", text: "Не удаляю", state: "done" },
        ],
        metadata: { status: "complete", reasoningDurationsMs: {} },
      },
    ];
    fireEvent.click(screen.getByLabelText("allow"));
    await failNextHistoryRead(server);
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("Не удаляю"));
  });

  it("браузерный вызов: хода уже нет (409 not_pending), поток закончился — лента перечитывает историю", async () => {
    const server = fakeChatServer();
    server.state.browserCall = { status: 409, kind: "not_pending" };
    let finishCall: (value: unknown) => void = () => {};
    const { bridge } = createAppBridge(() => ({ browserTools: { open_task: () => new Promise((resolve) => (finishCall = resolve)) }, toolUnavailableMessage: "нет" }));
    const hook = renderChatHook(server, { appBridge: { ...bridge, tabId: "tab-1" }, liveness });
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => hook.result.current.setValue("открой задачу"));
    act(() => void hook.result.current.submit());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;
    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "data-browser-call", id: "call-1", data: { toolCallId: "call-1", toolName: "open_task", input: {}, tabId: "tab-1" }, transient: true });
    });
    // Поток оборвался у вкладки, сервер довёл ход сам: вызов на сервере закрыт по сроку.
    act(() => stream.end());
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    server.state.history = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "открой задачу" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Страница не ответила вовремя", state: "done" }], metadata: { status: "complete" } },
    ];
    const reads = server.requestsTo("history").length;
    finishCall("открыла");
    await waitFor(() => expect(server.requestsTo("browserCall")).toHaveLength(1));
    await waitFor(() => expect(server.requestsTo("history").length).toBeGreaterThan(reads));
    await waitFor(() => expect(JSON.stringify(hook.result.current.messages)).toContain("Страница не ответила вовремя"));
  });
});
