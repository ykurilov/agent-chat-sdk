import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks, memoryTaskStore } from "../src/index";
import type { TaskStore } from "../src/types";
import { noticeOf } from "../src/task-delivery";
import { taskRecord } from "./store/task-store-contract";
import { callTool, controlledTool, createFakePort, FAKE_TIMERS, settle, toolsModel } from "./support/fake-port";

const START = new Date("2026-10-05T12:00:00.000Z");
const iso = (msFromStart: number) => new Date(START.getTime() + msFromStart).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ ...FAKE_TIMERS, now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(store: TaskStore = memoryTaskStore()) {
  const report = controlledTool();
  const background = createBackgroundTasks({ store, tools: { build_report: report.definition } });
  const port = createFakePort();
  background.attach(port);
  const start = async (period: string) => {
    const started = await callTool(background.tools(toolsModel()), "build_report", { period });
    await settle();
    return started.taskId as string;
  };
  return { store, background, port, runs: report.runs, start };
}

describe("доставка итогов (T056)", () => {
  it("чат занят — ждёт конца хода этого чата и доставляет сразу после", async () => {
    const { store, port, runs, start } = setup();
    const taskId = await start("март");
    port.chatState.set("chat-1", "busy");
    runs[0]!.resolve("готово");
    await settle();
    expect(port.attempts).toHaveLength(1);
    expect(port.delivered).toEqual([]);
    expect((await store.get("anna", taskId))?.deliveredAt).toBeUndefined();
    // Конец хода в другом чате не повод.
    port.finishTurn("anna", "chat-other");
    await settle();
    expect(port.attempts).toHaveLength(1);
    port.finishTurn("anna", "chat-1");
    await settle();
    expect(port.delivered).toHaveLength(1);
    expect(await store.get("anna", taskId)).toMatchObject({ deliveredAt: iso(0) });
  });

  it("событие конца хода потерялось — доставит обход раз в 10 с", async () => {
    const { port, runs, start } = setup();
    await start("март");
    port.chatState.set("chat-1", "busy");
    runs[0]!.resolve("готово");
    await settle();
    port.chatState.set("chat-1", "free");
    await vi.advanceTimersByTimeAsync(9_999);
    await settle();
    expect(port.delivered).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(port.delivered).toHaveLength(1);
  });

  it("все готовые задачи чата — одной пачкой, по порядку запуска", async () => {
    const { port, runs, start } = setup();
    const first = await start("март");
    await vi.advanceTimersByTimeAsync(1);
    const second = await start("апрель");
    port.chatState.set("chat-1", "busy");
    runs[1]!.resolve("апрель готов");
    runs[0]!.reject(new Error("март сломался"));
    await settle();
    port.finishTurn("anna", "chat-1");
    await settle();
    expect(port.delivered).toEqual([
      {
        ownerId: "anna",
        chatId: "chat-1",
        wakeAgent: true,
        deliveryKey: `task:${first}+task:${second}`,
        notices: [
          { kind: "task_failed", taskId: first, title: "Отчёт за март", error: "март сломался" },
          { kind: "task_done", taskId: second, title: "Отчёт за апрель", result: "апрель готов" },
        ],
      },
    ]);
  });

  it("чата больше нет — задача отменена, доставка не повторяется", async () => {
    const { store, port, runs, start } = setup();
    const taskId = await start("март");
    port.chatState.set("chat-1", "gone");
    runs[0]!.resolve("готово");
    await settle();
    expect(await store.get("anna", taskId)).toMatchObject({ status: "canceled", deliveredAt: iso(0) });
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(port.attempts).toHaveLength(1);
  });

  it("сбой доставки — в журнал и повтор обходом", async () => {
    const { port, runs, start } = setup();
    await start("март");
    const deliver = port.deliverNotices;
    port.deliverNotices = vi.fn().mockRejectedValueOnce(new Error("база чатов недоступна")).mockImplementation(deliver);
    runs[0]!.resolve("готово");
    await settle();
    expect(port.errors).toEqual([expect.objectContaining({ message: "база чатов недоступна" })]);
    expect(port.delivered).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(port.delivered).toHaveLength(1);
  });

  it("пока итог ждёт доставки, аренда продлевается: другая копия его не перехватит", async () => {
    const { store, port, runs, start } = setup();
    const taskId = await start("март");
    port.chatState.set("chat-1", "busy");
    runs[0]!.resolve("готово");
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    const task = await store.get("anna", taskId);
    expect(task?.leaseUntil! > iso(60_000)).toBe(true);
    expect(await store.listExpired(iso(60_000))).toEqual([]);
  });

  it("чужой итог (живая аренда другой копии) эта копия не доставляет", async () => {
    const store = memoryTaskStore();
    const foreign = taskRecord({ status: "done", result: "чужое", attempt: 1, leaseOwner: "other-copy", leaseUntil: iso(60_000) });
    await store.create(foreign);
    const { port } = setup(store);
    port.finishTurn("anna", foreign.chatId);
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(port.attempts).toEqual([]);
  });
});

describe("служебное сообщение несёт пометку чужого текста (043)", () => {
  it("итог фонового помощника, который вызывал инструмент с пометкой, — externalContent: true; без неё — поля нет", () => {
    const progress = { task: "найди", steps: [], text: "итог", status: "done" as const };
    const external = taskRecord({ kind: "helper", name: "researcher", status: "done", result: "итог", progress: { ...progress, externalContent: true } });
    expect(noticeOf(external)).toMatchObject({ kind: "task_done", externalContent: true });
    const plain = taskRecord({ kind: "helper", name: "researcher", status: "done", result: "итог", progress });
    expect(noticeOf(plain)).not.toHaveProperty("externalContent");
  });
});
