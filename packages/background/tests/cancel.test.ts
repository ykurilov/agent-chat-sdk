import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks, memoryTaskStore } from "../src/index";
import { callTool, controlledTool, createFakePort, FAKE_TIMERS, settle, toolsModel } from "./support/fake-port";

const START = new Date("2026-10-05T12:00:00.000Z");
const iso = (msFromStart: number) => new Date(START.getTime() + msFromStart).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ ...FAKE_TIMERS, now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const store = memoryTaskStore();
  const report = controlledTool();
  const background = createBackgroundTasks({ store, tools: { build_report: report.definition } });
  const port = createFakePort();
  background.attach(port);
  const start = async (period: string, chatId = "chat-1") => {
    const started = await callTool(background.tools(toolsModel({ chatId })), "build_report", { period });
    await settle();
    return started.taskId as string;
  };
  return { store, background, port, runs: report.runs, start };
}

describe("отмена человеком и удаление чата (T058)", () => {
  it("отмена — сигнал, статус canceled и пометка в чате без пробуждения агента", async () => {
    const { store, background, port, runs, start } = setup();
    const taskId = await start("март");
    port.emitted.length = 0;
    expect(await background.cancel("anna", "chat-1", taskId)).toBe("canceled");
    expect(runs[0]!.context.signal.aborted).toBe(true);
    await settle();
    expect(port.delivered).toEqual([
      { ownerId: "anna", chatId: "chat-1", wakeAgent: false, deliveryKey: `task:${taskId}`, notices: [{ kind: "task_canceled", taskId, title: "Отчёт за март" }] },
    ]);
    expect(await store.get("anna", taskId)).toMatchObject({ status: "canceled", finishedAt: iso(0), deliveredAt: iso(0) });
    expect(port.emitted).toContainEqual({ type: "tasks-changed", ownerId: "anna", chatId: "chat-1" });
    // Поздний итог отменённой задачи ничего не пишет.
    runs[0]!.resolve("поздно");
    await settle();
    expect((await store.get("anna", taskId))?.status).toBe("canceled");
    expect(port.delivered).toHaveLength(1);
  });

  it("чужая задача, другой чат, неизвестная — not_found; законченная — already_finished", async () => {
    const { background, runs, start } = setup();
    const taskId = await start("март");
    expect(await background.cancel("boris", "chat-1", taskId)).toBe("not_found");
    expect(await background.cancel("anna", "chat-other", taskId)).toBe("not_found");
    expect(await background.cancel("anna", "chat-1", "нет-такой")).toBe("not_found");
    runs[0]!.resolve("готово");
    await settle();
    expect(await background.cancel("anna", "chat-1", taskId)).toBe("already_finished");
  });

  it("отмена в занятом чате: пометка «отменена» уходит раньше итогов, которые будят агента", async () => {
    const { background, port, runs, start } = setup();
    const done = await start("март");
    const canceled = await start("апрель");
    port.chatState.set("chat-1", "busy");
    runs[0]!.resolve("март готов");
    await settle();
    await background.cancel("anna", "chat-1", canceled);
    await settle();
    port.finishTurn("anna", "chat-1");
    await settle();
    expect(port.delivered.map((input) => [input.wakeAgent, input.deliveryKey])).toEqual([
      [false, `task:${canceled}`],
      [true, `task:${done}`],
    ]);
  });

  it("удаление чата обрывает его задачи и стирает их; другие чаты не трогает", async () => {
    const { store, background, port, runs, start } = setup();
    const doomed = await start("март");
    const kept = await start("апрель", "chat-2");
    await background.chatDeleted("anna", "chat-1");
    expect(runs[0]!.context.signal.aborted).toBe(true);
    expect(runs[1]!.context.signal.aborted).toBe(false);
    expect(await store.get("anna", doomed)).toBeNull();
    runs[0]!.resolve("поздно");
    await settle();
    expect(await store.get("anna", doomed)).toBeNull();
    expect(port.attempts).toEqual([]);
    expect((await store.get("anna", kept))?.status).toBe("running");
  });
});
