// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubWorkSkin } from "./support/stub-work-skin";

setupChatDom();

const noticeMessage = (notices: Array<Record<string, unknown>>, id = "n1"): HistoryMessage => ({
  id,
  role: "user",
  parts: [{ type: "data-agent-notice", data: { notices } }],
});
const answer: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Принял", state: "done" }], metadata: { status: "complete" } };
const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Сделай отчёт" }] };

const plaques = () => Array.from(document.querySelectorAll<HTMLElement>('[data-kind="notice"]'));
const awaitingTask = { id: "t1", title: "Чистка заметок", kind: "helper", name: "cleaner", status: "awaiting_approval", startedAt: new Date().toISOString() };
const approvalNotice = {
  kind: "task_awaiting_approval",
  taskId: "t1",
  title: "Чистка заметок",
  approval: { approvalId: "ap1", toolName: "delete_notes", input: { ids: [1] } },
};

const render = (history: HistoryMessage[], tasks: Array<Record<string, unknown>> | null = null) => {
  const server = fakeChatServer({ history });
  server.state.tasks = tasks;
  renderAgentChat(server, { skin: stubWorkSkin });
  return server;
};

describe("AgentChat: служебные сообщения плашками", () => {
  it("сообщение с data-agent-notice — плашка на каждое служебное сообщение, пузыря человека нет", async () => {
    render([
      question,
      noticeMessage([
        { kind: "task_done", taskId: "t1", title: "Отчёт по сделкам", result: "Три сделки" },
        { kind: "task_failed", taskId: "t2", title: "Сводка", error: "модель недоступна" },
      ]),
      answer,
    ]);
    await waitFor(() => expect(plaques()).toHaveLength(2));
    expect(plaques().map((element) => [element.dataset.notice, element.dataset.title, element.dataset.result, element.dataset.error])).toEqual([
      ["task_done", "Отчёт по сделкам", "Три сделки", ""],
      ["task_failed", "Сводка", "", "модель недоступна"],
    ]);
    expect(screen.getByTestId("feed").textContent).toContain("Сделай отчёт");
    expect(plaques().every((plaque) => plaque.dataset.approval === "")).toBe(true);
  });

  it("task_canceled — плашка «отменена»; conversation_started — без текста указания агенту", async () => {
    render([
      noticeMessage([
        { kind: "task_canceled", taskId: "t1", title: "Отчёт" },
        { kind: "conversation_started", title: "Поздоровайся и спроси про планы" },
      ]),
      answer,
    ]);
    await waitFor(() => expect(plaques()).toHaveLength(2));
    expect(plaques()[0]!.dataset.notice).toBe("task_canceled");
    expect(plaques()[1]!.dataset.notice).toBe("conversation_started");
    expect(plaques()[1]!.dataset.title).toBe("");
    expect(screen.getByTestId("feed").textContent).not.toContain("Поздоровайся");
  });

  it("task_awaiting_approval, задача ждёт: кнопки без «всегда» → POST …/tasks/t1/approval, потом отметка решения", async () => {
    const server = render([question, noticeMessage([approvalNotice])], [awaitingTask]);
    await waitFor(() => expect(plaques()[0]?.dataset.approval).toBe("requested"));
    expect(screen.queryByLabelText("always")).toBeNull();
    fireEvent.click(screen.getByLabelText("deny"));
    await waitFor(() => expect(server.requestsTo("taskApproval")).toHaveLength(1));
    expect(server.requestsTo("taskApproval")[0]!.url).toBe("/api/chat/c1/tasks/t1/approval");
    expect(server.requestsTo("taskApproval")[0]!.body).toEqual({ decision: "deny", approvalId: "ap1" });
    await waitFor(() => expect(plaques()[0]!.dataset.approval).toBe("denied"));
  });

  it("задача задала новый вопрос: у старой плашки кнопок нет, решение по новой несёт её номер и старую не отмечает", async () => {
    const newer = { ...approvalNotice, approval: { approvalId: "ap2", toolName: "delete_notes", input: { ids: [2] } } };
    const progress = { pendingApproval: { approvalId: "ap2", toolName: "delete_notes", input: { ids: [2] } } };
    const server = render([question, noticeMessage([approvalNotice]), noticeMessage([newer], "n2")], [{ ...awaitingTask, progress }]);
    await waitFor(() => expect(plaques().map((plaque) => plaque.dataset.approval)).toEqual(["", "requested"]));
    fireEvent.click(screen.getByLabelText("allow"));
    await waitFor(() => expect(server.requestsTo("taskApproval")).toHaveLength(1));
    expect(server.requestsTo("taskApproval")[0]!.body).toEqual({ decision: "allow", approvalId: "ap2" });
    await waitFor(() => expect(plaques().map((plaque) => plaque.dataset.approval)).toEqual(["", "allowed"]));
  });

  it("решение не принято сервером — кнопки снова доступны с текстом сбоя", async () => {
    const server = render([question, noticeMessage([approvalNotice])], [awaitingTask]);
    server.state.fail.add("taskApproval");
    await waitFor(() => expect(plaques()[0]?.dataset.approval).toBe("requested"));
    fireEvent.click(screen.getByLabelText("allow"));
    await waitFor(() => expect(plaques()[0]!.dataset.approvalFailure).not.toBe(""));
    expect(plaques()[0]!.dataset.approval).toBe("requested");
    expect(plaques()[0]!.dataset.approvalPending).toBe("false");
  });

  it("задача уже не ждёт подтверждения (решено раньше или фона нет) — плашка без кнопок", async () => {
    render([question, noticeMessage([approvalNotice])], [{ ...awaitingTask, status: "running" }]);
    await waitFor(() => expect(plaques()).toHaveLength(1));
    expect(plaques()[0]!.dataset.approval).toBe("");
    expect(screen.queryByLabelText("allow")).toBeNull();
  });

  it("скин без AgentNoticeView (v16) — не пустой пузырь, а короткая строка из словаря; править её нельзя, указание агенту не видно", async () => {
    const server = fakeChatServer({
      history: [
        question,
        noticeMessage([
          { kind: "task_done", taskId: "t1", title: "Отчёт" },
          { kind: "task_failed", taskId: "t2", title: "Сводка", error: "модель недоступна" },
        ]),
        answer,
        noticeMessage([{ kind: "conversation_started", title: "Поздоровайся и спроси про планы" }], "n2"),
      ],
    });
    renderAgentChat(server);
    await waitFor(() => expect(screen.getByTestId("feed").textContent).toContain("Принял"));
    expect(plaques()).toHaveLength(0);
    const lines = Array.from(document.querySelectorAll('[data-kind="user"]')).map((element) => element.textContent);
    expect(lines).toEqual(["Сделай отчёт", "«Отчёт»: задача готова\n«Сводка»: задача не удалась", "агент написал первым"]);
    expect(screen.getByTestId("feed").textContent).not.toContain("Поздоровайся");
    // «Изменить» — только у настоящего сообщения человека.
    expect(document.querySelectorAll('[data-action="edit"]')).toHaveLength(1);
  });
});
