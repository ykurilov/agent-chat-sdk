// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubWorkSkin } from "./support/stub-work-skin";

setupChatDom();

const NOW = Date.parse("2026-10-05T12:00:00Z");
beforeEach(() => {
  // Подменены только часы и интервал: ожидания в тестах идут по настоящему времени.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const history: HistoryMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }];
const task = (id: string, status: string, startedAgoMs: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Задача ${id}`,
  kind: "helper",
  name: "researcher",
  status,
  startedAt: new Date(NOW - startedAgoMs).toISOString(),
  ...extra,
});

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-kind="task"]'));
const card = (id: string) => document.querySelector<HTMLElement>(`[data-task-id="${id}"]`);

const serverWithTasks = (tasks: Array<Record<string, unknown>>) => {
  const server = fakeChatServer({ history });
  server.state.watch = true;
  server.state.tasks = tasks;
  return server;
};

describe("AgentChat: карточки фоновых задач", () => {
  it("живые задачи — карточки в уведомлениях над полем; законченных карточек нет; «сколько идёт» растёт по часам", async () => {
    const server = serverWithTasks([
      task("t1", "running", 65_000),
      task("t2", "queued", 1_000),
      task("t3", "awaiting_approval", 5_000),
      task("t4", "done", 90_000, { finishedAt: new Date(NOW - 10_000).toISOString() }),
    ]);
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(server.requestsTo("tasks")[0]!.url).toBe("/api/chat/c1/tasks");
    expect(screen.getByTestId("notice").contains(card("t1"))).toBe(true);
    expect(cards().map((element) => element.dataset.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(card("t1")!.textContent).toBe("Задача t1");
    expect(card("t1")!.dataset.status).toBe("running");
    expect(card("t1")!.dataset.elapsed).toBe("65000");
    act(() => vi.advanceTimersByTime(2_000));
    expect(card("t1")!.dataset.elapsed).toBe("67000");
    expect(card("t4")).toBeNull();
  });

  it("«Отменить»: POST …/tasks/:id/cancel, кнопка занята, пока сервер не ответил; потом список перечитывается", async () => {
    const server = serverWithTasks([task("t1", "running", 1_000)]);
    server.state.hang.add("taskCancel");
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(card("t1")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("отменить t1"));
    await waitFor(() => expect(server.requestsTo("taskCancel")).toHaveLength(1));
    expect(server.requestsTo("taskCancel")[0]!.url).toBe("/api/chat/c1/tasks/t1/cancel");
    expect(card("t1")!.dataset.canceling).toBe("true");
    const reads = server.requestsTo("tasks").length;
    server.state.hang.delete("taskCancel");
    server.state.tasks = [task("t1", "canceled", 1_000)];
    fireEvent.click(screen.getByLabelText("отменить t1"));
    await waitFor(() => expect(server.requestsTo("tasks").length).toBeGreaterThan(reads));
    await waitFor(() => expect(card("t1")).toBeNull());
  });

  it("отмена не прошла (500) — кнопка снова доступна", async () => {
    const server = serverWithTasks([task("t1", "running", 1_000)]);
    server.state.fail.add("taskCancel");
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(card("t1")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("отменить t1"));
    await waitFor(() => expect(server.requestsTo("taskCancel")).toHaveLength(1));
    await waitFor(() => expect(card("t1")!.dataset.canceling).toBe("false"));
  });

  it("tasks-changed из подписки — список перечитывается", async () => {
    const server = serverWithTasks([]);
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(server.watches).toHaveLength(1));
    await waitFor(() => expect(server.requestsTo("tasks").length).toBeGreaterThan(0));
    server.state.tasks = [task("t9", "running", 0)];
    act(() => server.emit({ type: "tasks-changed" }));
    await waitFor(() => expect(card("t9")).toBeTruthy());
  });

  it("адреса задач нет (404): карточек нет, больше не спрашивает", async () => {
    const server = fakeChatServer({ history });
    server.state.watch = true;
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(server.requestsTo("tasks")).toHaveLength(1));
    act(() => server.emit({ type: "tasks-changed" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.requestsTo("tasks")).toHaveLength(1);
    expect(cards()).toHaveLength(0);
  });

  it("сервер заявил, что фона нет (backgroundTasks: false): задачи не запрашиваются совсем", async () => {
    const server = fakeChatServer({ history });
    server.state.watch = true;
    server.state.backgroundTasks = false;
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(server.watches).toHaveLength(1));
    act(() => server.emit({ type: "tasks-changed" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.requestsTo("tasks")).toHaveLength(0);
  });

  it("сервер заявил фон (backgroundTasks: true): задачи запрашиваются", async () => {
    const server = serverWithTasks([task("t1", "running", 1_000)]);
    server.state.backgroundTasks = true;
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(card("t1")).toBeTruthy());
  });

  it("сервер без заявки (старый): задачи запрашиваются, как раньше", async () => {
    const server = serverWithTasks([task("t1", "running", 1_000)]);
    expect(server.state.backgroundTasks).toBeUndefined();
    renderAgentChat(server, { skin: stubWorkSkin });
    await waitFor(() => expect(card("t1")).toBeTruthy());
  });

  it("скин без карточек и плашек — задачи не запрашиваются", async () => {
    const server = serverWithTasks([task("t1", "running", 1_000)]);
    renderAgentChat(server);
    await waitFor(() => expect(server.watches).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.requestsTo("tasks")).toHaveLength(0);
  });
});
