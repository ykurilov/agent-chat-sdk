import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks, memoryTaskStore } from "../src/index";
import { callTool, controlledTool, createFakePort, FAKE_TIMERS, settle, toolsModel } from "./support/fake-port";

beforeEach(() => {
  vi.useFakeTimers({ ...FAKE_TIMERS, now: new Date("2026-10-05T12:00:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(options: { maxRunningPerUser?: number; needsApproval?: boolean } = {}) {
  const store = memoryTaskStore();
  const report = controlledTool(options.needsApproval ? { needsApproval: true } : {});
  const background = createBackgroundTasks({
    store,
    tools: { build_report: report.definition },
    ...(options.maxRunningPerUser !== undefined && { maxRunningPerUser: options.maxRunningPerUser }),
  });
  const port = createFakePort();
  background.attach(port);
  return { store, background, port, runs: report.runs };
}

describe("фоновый инструмент: запуск (T051)", () => {
  it("инструменты хода: фоновые, check_tasks и cancel_task; подтверждение до запуска — обычный признак инструмента", () => {
    const plain = setup();
    expect(Object.keys(plain.background.tools(toolsModel())).sort()).toEqual(["build_report", "cancel_task", "check_tasks"]);
    expect(plain.background.toolNames).toEqual(["build_report", "check_tasks", "cancel_task"]);
    expect(plain.background.tools(toolsModel()).build_report?.needsApproval).toBeFalsy();
    const asking = setup({ needsApproval: true });
    expect(asking.background.tools(toolsModel()).build_report?.needsApproval).toBe(true);
  });

  it("пометка чужого текста (`metadata: { externalContent: true }`) переходит в инструмент хода: вызов в чате помечен сразу", () => {
    const store = memoryTaskStore();
    const external = createBackgroundTasks({ store, tools: { fetch_mail: controlledTool({ metadata: { externalContent: true } }).definition } });
    expect(external.tools(toolsModel()).fetch_mail?.metadata).toEqual({ externalContent: true });
    expect(setup().background.tools(toolsModel()).build_report?.metadata).toBeUndefined();
  });

  it("запуск сразу отвечает «started», пишет задачу и запускает её, не дожидаясь конца", async () => {
    const { store, background, port, runs } = setup();
    const tools = background.tools(toolsModel({ messageId: "answer-7", channel: "telegram" }));
    const started = await callTool(tools, "build_report", { period: "март" });
    expect(started).toEqual({ status: "started", taskId: expect.any(String), title: "Отчёт за март" });
    await settle();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.input).toEqual({ period: "март" });
    expect(runs[0]!.context).toMatchObject({ ownerId: "anna", chatId: "chat-1" });
    const task = await store.get("anna", started.taskId);
    expect(task).toMatchObject({
      ownerId: "anna",
      chatId: "chat-1",
      messageId: "answer-7",
      channel: "telegram",
      kind: "tool",
      name: "build_report",
      input: { period: "март" },
      title: "Отчёт за март",
      status: "running",
      attempt: 1,
      toolCallId: expect.stringMatching(/^call-/),
    });
    expect(port.emitted).toContainEqual({ type: "tasks-changed", ownerId: "anna", chatId: "chat-1" });
  });

  it("без полей хода из ядра — номер ответа пустой, канал web", async () => {
    const { store, background } = setup();
    const started = await callTool(background.tools(toolsModel()), "build_report", { period: "май" });
    expect(await store.get("anna", started.taskId)).toMatchObject({ messageId: "", channel: "web" });
  });

  it("ответ на настоящих часах быстрее 300 мс, пока сама задача идёт", async () => {
    vi.useRealTimers();
    const { background, runs } = setup();
    const before = performance.now();
    const started = await callTool(background.tools(toolsModel()), "build_report", { period: "июнь" });
    expect(performance.now() - before).toBeLessThan(300);
    expect(started.status).toBe("started");
    await settle();
    expect(runs).toHaveLength(1);
    await background.flush();
  });

  it("больше трёх задач у человека — отказ «слишком много задач», задача не создаётся", async () => {
    const { store, background } = setup();
    const tools = background.tools(toolsModel());
    for (const period of ["январь", "февраль", "март"]) expect((await callTool(tools, "build_report", { period })).status).toBe("started");
    const refused = await callTool(tools, "build_report", { period: "апрель" });
    expect(refused).toEqual({ status: "too_many_tasks", message: expect.stringMatching(/слишком много.*дождитесь.*отмените/is) });
    expect(await store.listForChat("anna", "chat-1")).toHaveLength(3);
    // У другого человека свой предел.
    expect((await callTool(background.tools(toolsModel({ ownerId: "boris" })), "build_report", { period: "апрель" })).status).toBe("started");
  });

  it("одновременные запуски не обходят предел", async () => {
    const { store, background } = setup();
    const tools = background.tools(toolsModel());
    const results = await Promise.all(["1", "2", "3", "4", "5"].map((period) => callTool(tools, "build_report", { period })));
    expect(results.filter((result) => result.status === "started")).toHaveLength(3);
    expect(await store.countActive("anna")).toBe(3);
  });

  it("предел задаётся настройкой; закончившаяся задача место освобождает", async () => {
    const { background, runs } = setup({ maxRunningPerUser: 1 });
    const tools = background.tools(toolsModel());
    expect((await callTool(tools, "build_report", { period: "1" })).status).toBe("started");
    expect((await callTool(tools, "build_report", { period: "2" })).status).toBe("too_many_tasks");
    await settle();
    runs[0]!.resolve("готово");
    await settle();
    expect((await callTool(tools, "build_report", { period: "3" })).status).toBe("started");
  });

  it("неверные настройки — ошибка при создании", () => {
    const store = memoryTaskStore();
    expect(() => createBackgroundTasks({ store, maxRunningPerUser: 0 })).toThrow(/maxRunningPerUser/);
    expect(() => createBackgroundTasks({ store, leaseMs: 10 })).toThrow(/leaseMs/);
    expect(() => createBackgroundTasks({ store, tools: { "Плохое имя": controlledTool().definition } })).toThrow(/Плохое имя/);
    expect(() => createBackgroundTasks({ store, tools: { check_tasks: controlledTool().definition } })).toThrow(/check_tasks/);
  });

  it("инструменты до подключения к ядру — понятная ошибка при вызове", async () => {
    const background = createBackgroundTasks({ store: memoryTaskStore(), tools: { build_report: controlledTool().definition } });
    await expect(callTool(background.tools(toolsModel()), "build_report", { period: "1" })).rejects.toThrow(/attach/);
  });
});

describe("check_tasks, cancel_task и инструкция (T057)", () => {
  it("check_tasks — задачи этого чата: название, состояние, ход", async () => {
    const { background, runs } = setup();
    const tools = background.tools(toolsModel());
    const first = await callTool(tools, "build_report", { period: "март" });
    await callTool(background.tools(toolsModel({ chatId: "chat-other" })), "build_report", { period: "апрель" });
    await settle();
    runs[0]!.context.reportProgress("Собрал 40 сделок из 100");
    await settle();
    const checked = await callTool(tools, "check_tasks", {});
    expect(checked).toEqual({
      tasks: [{ taskId: first.taskId, title: "Отчёт за март", status: "running", startedAt: "2026-10-05T12:00:00.000Z", progress: "Собрал 40 сделок из 100" }],
    });
  });

  it("cancel_task отменяет задачу этого чата: сигнал срабатывает, служебного сообщения нет — агент сам знает", async () => {
    const { store, background, port, runs } = setup();
    const tools = background.tools(toolsModel());
    const started = await callTool(tools, "build_report", { period: "март" });
    await settle();
    expect(await callTool(tools, "cancel_task", { taskId: started.taskId })).toEqual({ status: "canceled", taskId: started.taskId });
    expect(runs[0]!.context.signal.aborted).toBe(true);
    runs[0]!.resolve("поздний итог");
    await settle();
    expect(await store.get("anna", started.taskId)).toMatchObject({ status: "canceled", deliveredAt: expect.any(String) });
    expect(port.attempts).toEqual([]);
  });

  it("cancel_task: чужой чат и неизвестная задача — not_found, законченная — already_finished", async () => {
    const { background, runs } = setup();
    const started = await callTool(background.tools(toolsModel()), "build_report", { period: "март" });
    const otherChat = background.tools(toolsModel({ chatId: "chat-other" }));
    expect(await callTool(otherChat, "cancel_task", { taskId: started.taskId })).toEqual({ status: "not_found", taskId: started.taskId });
    expect(await callTool(otherChat, "cancel_task", { taskId: "нет-такой" })).toEqual({ status: "not_found", taskId: "нет-такой" });
    await settle();
    runs[0]!.resolve("готово");
    await settle();
    expect(await callTool(background.tools(toolsModel()), "cancel_task", { taskId: started.taskId })).toEqual({
      status: "already_finished",
      taskId: started.taskId,
    });
  });

  it("инструкция — постоянный блок: про запуск, ожидание итога, check_tasks, cancel_task и предел", () => {
    const { background } = setup();
    expect(background.instructions).toMatch(/check_tasks/);
    expect(background.instructions).toMatch(/cancel_task/);
    expect(background.instructions).toMatch(/3/);
    expect(background.instructions).toBe(setup().background.instructions);
  });
});
