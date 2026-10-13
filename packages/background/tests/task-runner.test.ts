import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks, memoryTaskStore } from "../src/index";
import type { TaskStore } from "../src/types";
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

function setup(options: { store?: TaskStore; rerunAfterRestart?: boolean; timeoutMs?: number; serviceTimeoutMs?: number } = {}) {
  const store = options.store ?? memoryTaskStore();
  const report = controlledTool({
    ...(options.rerunAfterRestart !== undefined && { rerunAfterRestart: options.rerunAfterRestart }),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
  });
  const background = createBackgroundTasks({
    store,
    tools: { build_report: report.definition },
    ...(options.serviceTimeoutMs !== undefined && { timeoutMs: options.serviceTimeoutMs }),
  });
  const port = createFakePort();
  background.attach(port);
  return { store, background, port, runs: report.runs };
}

async function start(background: ReturnType<typeof setup>["background"], period = "март"): Promise<string> {
  const started = await callTool(background.tools(toolsModel()), "build_report", { period });
  await settle();
  return started.taskId as string;
}

describe("бегунок задач (T052)", () => {
  it("аренда 30 с, продление раз в 10 с, пока задача идёт", async () => {
    const { store, background } = setup();
    const taskId = await start(background);
    expect((await store.get("anna", taskId))?.leaseUntil).toBe(iso(30_000));
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect((await store.get("anna", taskId))?.leaseUntil).toBe(iso(40_000));
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect((await store.get("anna", taskId))?.leaseUntil).toBe(iso(50_000));
    await background.flush();
  });

  it("готовая задача: итог в базе, служебное сообщение с ключом task:<id>, отметка о доставке, аренда снята", async () => {
    const { store, background, port, runs } = setup();
    const taskId = await start(background);
    await vi.advanceTimersByTimeAsync(5_000);
    runs[0]!.resolve({ rows: 3, total: "1 200 ₽" });
    await settle();
    const task = await store.get("anna", taskId);
    expect(task).toMatchObject({ status: "done", result: { rows: 3, total: "1 200 ₽" }, finishedAt: iso(5_000), deliveredAt: iso(5_000) });
    expect(task).not.toHaveProperty("leaseOwner");
    expect(port.delivered).toEqual([
      {
        ownerId: "anna",
        chatId: "chat-1",
        wakeAgent: true,
        deliveryKey: `task:${taskId}`,
        notices: [{ kind: "task_done", taskId, title: "Отчёт за март", result: '{"rows":3,"total":"1 200 ₽"}' }],
      },
    ]);
    expect(port.emitted.filter((event) => event.type === "tasks-changed").length).toBeGreaterThanOrEqual(2);
  });

  it("длинный итог обрезается для служебного сообщения, в базе — целиком", async () => {
    const { store, background, port, runs } = setup();
    const taskId = await start(background);
    runs[0]!.resolve("я".repeat(60_000));
    await settle();
    expect((await store.get("anna", taskId))?.result).toHaveLength(60_000);
    const result = port.delivered[0]!.notices[0]!.result!;
    expect(result.length).toBeLessThanOrEqual(50_000);
    expect(result).toMatch(/обрезан/);
  });

  it("ошибка задачи — failed с текстом ошибки и служебное сообщение task_failed", async () => {
    const { store, background, port, runs } = setup();
    const taskId = await start(background);
    runs[0]!.reject(new Error("база отчётов недоступна"));
    await settle();
    expect(await store.get("anna", taskId)).toMatchObject({ status: "failed", error: "база отчётов недоступна" });
    expect(port.delivered[0]!.notices).toEqual([{ kind: "task_failed", taskId, title: "Отчёт за март", error: "база отчётов недоступна" }]);
  });

  it("таймаут инструмента — сигнал отмены, timed_out и служебное сообщение", async () => {
    const { store, background, port, runs } = setup({ timeoutMs: 60_000 });
    const taskId = await start(background);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(runs[0]!.context.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(runs[0]!.context.signal.aborted).toBe(true);
    expect(await store.get("anna", taskId)).toMatchObject({ status: "timed_out", finishedAt: iso(60_000) });
    expect(port.delivered[0]!.notices[0]).toMatchObject({ kind: "task_timed_out", taskId, error: expect.stringMatching(/1 мин/) });
    // Поздний итог после таймаута ничего не меняет.
    runs[0]!.resolve("поздно");
    await settle();
    expect((await store.get("anna", taskId))?.status).toBe("timed_out");
    expect(port.delivered).toHaveLength(1);
  });

  it("общий таймаут службы — по умолчанию 30 минут", async () => {
    const { store, background } = setup();
    const taskId = await start(background);
    await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
    expect((await store.get("anna", taskId))?.status).toBe("running");
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect((await store.get("anna", taskId))?.status).toBe("timed_out");
  });

  it("reportProgress — ход в карточке и событие tasks-changed", async () => {
    const { store, background, port, runs } = setup();
    const taskId = await start(background);
    port.emitted.length = 0;
    runs[0]!.context.reportProgress("Собрал 40 сделок из 100");
    await settle();
    expect((await store.get("anna", taskId))?.progress).toEqual({ task: "Отчёт за март", steps: [], text: "Собрал 40 сделок из 100", status: "running" });
    expect(port.emitted).toEqual([{ type: "tasks-changed", ownerId: "anna", chatId: "chat-1" }]);
    const views = await background.listForChat("anna", "chat-1");
    expect(views).toEqual([
      {
        id: taskId,
        title: "Отчёт за март",
        kind: "tool",
        name: "build_report",
        status: "running",
        startedAt: iso(0),
        progress: { task: "Отчёт за март", steps: [], text: "Собрал 40 сделок из 100", status: "running" },
      },
    ]);
  });

  it("частые reportProgress не копят записи: в базе последнее значение", async () => {
    const { store, background, runs } = setup();
    const taskId = await start(background);
    for (let index = 1; index <= 50; index += 1) runs[0]!.context.reportProgress(`шаг ${index}`);
    await settle(10);
    expect((await store.get("anna", taskId))?.progress?.text).toBe("шаг 50");
  });

  it("аренду забрала другая копия — задача здесь останавливается и ничего не пишет", async () => {
    const { store, background, port, runs } = setup();
    const taskId = await start(background);
    await store.update("anna", taskId, { leaseOwner: "copy-other" });
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(runs[0]!.context.signal.aborted).toBe(true);
    runs[0]!.resolve("итог, который уже не наш");
    await settle();
    expect(await store.get("anna", taskId)).toMatchObject({ status: "running", leaseOwner: "copy-other" });
    expect(port.attempts).toEqual([]);
  });
});

describe("восстановление после сбоя (T053)", () => {
  it("просроченная аренда без rerunAfterRestart — interrupted и служебное сообщение", async () => {
    const store = memoryTaskStore();
    const stale = taskRecord({ status: "running", attempt: 1, startedAt: iso(-60_000), leaseOwner: "dead-copy", leaseUntil: iso(-1) });
    await store.create(stale);
    const { background, port, runs } = setup({ store });
    await background.recover();
    await settle();
    expect(runs).toHaveLength(0);
    expect(await store.get("anna", stale.id)).toMatchObject({ status: "interrupted", finishedAt: iso(0), deliveredAt: iso(0) });
    expect(port.delivered).toEqual([
      { ownerId: "anna", chatId: stale.chatId, wakeAgent: true, deliveryKey: `task:${stale.id}`, notices: [{ kind: "task_interrupted", taskId: stale.id, title: stale.title }] },
    ]);
    await background.flush();
  });

  it("просроченная аренда с rerunAfterRestart — запуск заново, вторая попытка", async () => {
    const store = memoryTaskStore();
    const stale = taskRecord({ status: "running", attempt: 1, startedAt: iso(-60_000), leaseOwner: "dead-copy", leaseUntil: iso(-1) });
    await store.create(stale);
    const { background, port, runs } = setup({ store, rerunAfterRestart: true });
    await background.recover();
    await settle();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.input).toEqual(stale.input);
    expect(await store.get("anna", stale.id)).toMatchObject({ status: "running", attempt: 2, startedAt: iso(-60_000) });
    runs[0]!.resolve("после перезапуска");
    await settle();
    expect(port.delivered[0]!.notices[0]).toMatchObject({ kind: "task_done", result: "после перезапуска" });
    await background.flush();
  });

  it("задача, падающая вместе с сервером, после третьей попытки получает interrupted", async () => {
    const store = memoryTaskStore();
    const stale = taskRecord({ status: "running", attempt: 3, leaseOwner: "dead-copy", leaseUntil: iso(-1) });
    await store.create(stale);
    const { background, runs } = setup({ store, rerunAfterRestart: true });
    await background.recover();
    await settle();
    expect(runs).toHaveLength(0);
    expect((await store.get("anna", stale.id))?.status).toBe("interrupted");
    await background.flush();
  });

  it("задача, которую так и не запустили, запускается без оглядки на rerunAfterRestart", async () => {
    const store = memoryTaskStore();
    const queued = taskRecord({ status: "queued", leaseOwner: "dead-copy", leaseUntil: iso(-1) });
    await store.create(queued);
    const { background, runs } = setup({ store });
    await background.recover();
    await settle();
    expect(runs).toHaveLength(1);
    await background.flush();
  });

  it("законченная, но не доставленная задача доставляется копией, которая её подобрала", async () => {
    const store = memoryTaskStore();
    const finished = taskRecord({ status: "failed", error: "сбой", attempt: 1, finishedAt: iso(-5_000), leaseOwner: "dead-copy", leaseUntil: iso(-1) });
    await store.create(finished);
    const { background, port } = setup({ store });
    await background.recover();
    await settle();
    expect(port.delivered[0]!.notices).toEqual([{ kind: "task_failed", taskId: finished.id, title: finished.title, error: "сбой" }]);
    expect(await store.get("anna", finished.id)).toMatchObject({ status: "failed", deliveredAt: iso(0) });
    await background.flush();
  });

  it("инструмента больше нет в настройках — failed с понятной причиной", async () => {
    const store = memoryTaskStore();
    const orphan = taskRecord({ name: "removed_tool", status: "running", attempt: 1, leaseOwner: "dead-copy", leaseUntil: iso(-1) });
    await store.create(orphan);
    const { background } = setup({ store, rerunAfterRestart: true });
    await background.recover();
    await settle();
    expect(await store.get("anna", orphan.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/removed_tool/) });
    await background.flush();
  });

  it("живая чужая аренда не трогается; после её истечения копия подбирает задачу обходом раз в 10 с", async () => {
    const store = memoryTaskStore();
    const alive = taskRecord({ status: "running", attempt: 1, leaseOwner: "other-copy", leaseUntil: iso(15_000) });
    await store.create(alive);
    const { background } = setup({ store });
    await background.recover();
    await settle();
    expect((await store.get("anna", alive.id))?.status).toBe("running");
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect((await store.get("anna", alive.id))?.status).toBe("running");
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect((await store.get("anna", alive.id))?.status).toBe("interrupted");
    await background.flush();
  });

  it("штатная остановка отпускает аренду: следующий старт подбирает задачу сразу, старый итог не пишется", async () => {
    const store = memoryTaskStore();
    const first = setup({ store, rerunAfterRestart: true });
    const taskId = await start(first.background);
    const firstOwner = (await store.get("anna", taskId))?.leaseOwner;
    await first.background.flush();
    expect(first.runs[0]!.context.signal.aborted).toBe(true);
    first.runs[0]!.resolve("итог остановленной копии");
    await settle();
    expect((await store.get("anna", taskId))?.status).toBe("running");
    expect(first.port.attempts).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    const second = setup({ store, rerunAfterRestart: true });
    await second.background.recover();
    await settle();
    expect(second.runs).toHaveLength(1);
    const taken = await store.get("anna", taskId);
    expect(taken).toMatchObject({ status: "running", attempt: 2 });
    expect(taken?.leaseOwner).not.toBe(firstOwner);
    await second.background.flush();
  });

  it("сбой хранилища при обходе — в журнал, обход продолжается", async () => {
    const store = memoryTaskStore();
    const broken: TaskStore = { ...store, listExpired: vi.fn().mockRejectedValueOnce(new Error("база недоступна")).mockImplementation(store.listExpired) };
    const { background, port } = setup({ store: broken });
    await expect(background.recover()).rejects.toThrow(/база недоступна/);
    await store.create(taskRecord({ status: "running", attempt: 1, leaseOwner: "dead-copy", leaseUntil: iso(-1) }));
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(port.delivered).toHaveLength(1);
    await background.flush();
  });
});
