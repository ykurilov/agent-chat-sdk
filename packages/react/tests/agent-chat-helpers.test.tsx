// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom, submitQuestion } from "./support/chat-dom";
import { stubWorkSkin } from "./support/stub-work-skin";

setupChatDom();

const doneProgress = {
  task: "Найди три статьи про сон",
  steps: [
    { type: "tool", toolName: "web_search", input: { query: "сон" }, output: ["a", "b"] },
    { type: "tool", toolName: "fetch_page", input: { url: "x" }, error: "timeout" },
    { type: "text", text: "Нашёл две" },
  ],
  text: "Вот две статьи",
  status: "done",
};

const awaitingProgress = {
  task: "Удали старые заметки",
  steps: [{ type: "text", text: "Нашёл три заметки" }],
  text: "",
  status: "awaiting_approval",
  pendingApproval: { approvalId: "hap1", toolName: "delete_notes", title: "Удалить заметки", input: { ids: [1, 2, 3] } },
};

const answerWith = (part: Record<string, unknown>, status = "complete"): HistoryMessage[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Сделай" }] },
  { id: "a1", role: "assistant", parts: [{ type: "step-start" }, part], metadata: { status, reasoningDurationsMs: {} } },
];

const helperPart = (overrides: Record<string, unknown> = {}) => ({
  type: "tool-helper_researcher",
  toolCallId: "call-h",
  state: "output-available",
  input: { task: "Найди три статьи про сон" },
  output: doneProgress,
  ...overrides,
});

const helperRow = () => document.querySelector('[data-kind="helper"]') as HTMLElement;

describe("AgentChat: строка помощника", () => {
  it("вызов helper_* рисуется HelperCallRow: имя без приставки, задание, шаги, итог, статус; строки инструмента нет", async () => {
    renderAgentChat(fakeChatServer({ history: answerWith(helperPart()) }), { skin: stubWorkSkin });
    await waitFor(() => expect(helperRow()).toBeTruthy());
    expect(document.querySelector('[data-kind="tool"]')).toBeNull();
    expect(helperRow().dataset.name).toBe("researcher");
    expect(helperRow().dataset.task).toBe("Найди три статьи про сон");
    expect(helperRow().dataset.text).toBe("Вот две статьи");
    expect(helperRow().dataset.status).toBe("done");
    expect(helperRow().dataset.approval).toBe("");
    expect(JSON.parse(helperRow().dataset.steps!)).toEqual([
      { kind: "tool", id: "0", toolName: "web_search", state: "done", input: { query: "сон" }, output: ["a", "b"] },
      { kind: "tool", id: "1", toolName: "fetch_page", state: "error", input: { url: "x" }, errorText: "timeout" },
      { kind: "text", id: "2", text: "Нашёл две" },
    ]);
  });

  it("помощник ещё без вывода: задание из входа, статус «работает», раскрытие переключается", async () => {
    renderAgentChat(fakeChatServer({ history: answerWith(helperPart({ state: "input-available", output: undefined })) }), { skin: stubWorkSkin });
    await waitFor(() => expect(helperRow()).toBeTruthy());
    expect(helperRow().dataset.task).toBe("Найди три статьи про сон");
    expect(helperRow().dataset.status).toBe("running");
    expect(helperRow().dataset.open).toBe("false");
    fireEvent.click(screen.getByLabelText("помощник"));
    expect(helperRow().dataset.open).toBe("true");
  });

  it("сбой вызова помощника — статус «не получилось» с текстом ошибки", async () => {
    renderAgentChat(fakeChatServer({ history: answerWith(helperPart({ state: "output-error", output: undefined, errorText: "упал" })) }), { skin: stubWorkSkin });
    await waitFor(() => expect(helperRow()).toBeTruthy());
    expect(helperRow().dataset.status).toBe("failed");
    expect(helperRow().dataset.error).toBe("упал");
  });

  it("скин без HelperCallRow: вызов помощника — обычная строка инструмента", async () => {
    renderAgentChat(fakeChatServer({ history: answerWith(helperPart()) }));
    await waitFor(() => expect(document.querySelector('[data-kind="tool"]')).toBeTruthy());
    expect(document.querySelector('[data-kind="tool"]')?.getAttribute("data-tool")).toBe("helper_researcher");
  });

  it("подтверждение внутри помощника: карточка без «всегда», ответ на тот же адрес, продолжение в том же сообщении", async () => {
    const server = fakeChatServer({
      history: answerWith(helperPart({ preliminary: true, output: awaitingProgress, input: { task: "Удали старые заметки" } }), "awaiting_approval"),
      resumable: true,
    });
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(helperRow()).toBeTruthy());
    expect(helperRow().dataset.status).toBe("awaiting_approval");
    expect(helperRow().dataset.approval).toBe("requested");
    expect(JSON.parse(helperRow().dataset.approvalAction!)).toEqual({ toolName: "delete_notes", title: "Удалить заметки", input: { ids: [1, 2, 3] } });
    expect(screen.queryByLabelText("always")).toBeNull();
    fireEvent.click(screen.getByLabelText("allow"));
    await waitFor(() => expect(server.requestsTo("approval")).toHaveLength(1));
    expect(server.requestsTo("approval")[0]!.url).toMatch(/\/api\/chat\/c1\/approvals\/hap1$/);
    expect(server.requestsTo("approval")[0]!.body).toMatchObject({ decision: "allow" });
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    const stream = server.resumed[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({
      type: "tool-output-available",
      toolCallId: "call-h",
      output: { ...awaitingProgress, status: "done", pendingApproval: undefined, text: "Удалил три" },
    });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Готово" });
    stream.finish();
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("Готово"));
    expect(document.querySelectorAll('[data-kind="agent"]')).toHaveLength(1);
    expect(helperRow().dataset.status).toBe("done");
    expect(helperRow().dataset.text).toBe("Удалил три");
  });

  it("новое сообщение вместо ответа на подтверждение помощника: запрос показан отклонённым", async () => {
    const server = fakeChatServer({
      history: answerWith(helperPart({ preliminary: true, output: awaitingProgress }), "awaiting_approval"),
    });
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(helperRow()?.dataset.approval).toBe("requested"));
    submitQuestion("не надо");
    await waitFor(() => expect(helperRow().dataset.approval).toBe("denied"));
  });
});
