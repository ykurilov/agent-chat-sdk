import { TurnRefusedError } from "@ykurilov/agent-chat-core";
import type { AgentHelper, HelperProgress, RunHelperInput, RunHelperResult } from "@ykurilov/agent-chat-core";
import type { ModelMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks, memoryTaskStore } from "../src/index";
import type { TaskStore } from "../src/types";
import { callTool, createFakePort, FAKE_TIMERS, settle, toolsModel } from "./support/fake-port";

const START = new Date("2026-10-05T12:00:00.000Z");
const iso = (msFromStart: number) => new Date(START.getTime() + msFromStart).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ ...FAKE_TIMERS, now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

const researcher: AgentHelper = {
  description: "Ищет сведения в сети",
  instructions: "Ищи и пиши коротко",
  model: { providerId: "fake", modelId: "fake-model" },
  background: true,
};

const message = (index: number): ModelMessage => ({ role: "assistant", content: `шаг ${index}` });
const progress = (status: HelperProgress["status"], text = "", extra: Partial<HelperProgress> = {}): HelperProgress => ({
  task: "Найди цены",
  steps: [],
  text,
  status,
  ...extra,
});

/** Поддельный цикл помощника: шаги по одному, итог — по команде теста. */
function scriptedHelper() {
  const calls: Array<RunHelperInput & { step(count: number): Promise<void>; finish(result: Omit<RunHelperResult, "messages">): void }> = [];
  const runHelper = async (input: RunHelperInput): Promise<RunHelperResult> =>
    new Promise((resolve, reject) => {
      let messages = [...(input.priorMessages ?? [])];
      input.abortSignal.addEventListener("abort", () => reject(input.abortSignal.reason));
      calls.push({
        ...input,
        async step(count) {
          for (let index = 0; index < count; index += 1) {
            messages = [...messages, message(messages.length + 1)];
            await input.onStep({ messages, progress: progress("running", `сделано шагов: ${messages.length}`) });
          }
        },
        finish(result) {
          resolve({ ...result, messages });
        },
      });
    });
  return { calls, runHelper };
}

function setup(store: TaskStore = memoryTaskStore(), maxRunningPerUser?: number) {
  const helper = scriptedHelper();
  const background = createBackgroundTasks({ store, ...(maxRunningPerUser !== undefined && { maxRunningPerUser }) });
  const port = createFakePort({ helpers: { researcher }, runHelper: helper.runHelper });
  background.attach(port);
  return { store, background, port, calls: helper.calls };
}

describe("фоновый помощник (T054)", () => {
  it("helper_<имя> создаёт задачу и сразу отвечает «работает в фоне»; модель видит короткий текст", async () => {
    const { store, background, port, calls } = setup();
    const tools = background.tools(toolsModel());
    expect(background.toolNames).toEqual(["helper_researcher", "check_tasks", "cancel_task"]);
    const answer = await callTool(tools, "helper_researcher", { task: "Найди цены" });
    expect(answer).toEqual({ task: "Найди цены", steps: [], text: "", status: "background", taskId: expect.any(String) });
    const modelSees = await tools.helper_researcher!.toModelOutput!({ toolCallId: "call", input: { task: "Найди цены" }, output: answer });
    expect(modelSees).toEqual({ type: "text", value: `Помощник работает в фоне (задача ${answer.taskId}): итог придёт позже.` });
    await settle();
    expect(await store.get("anna", answer.taskId)).toMatchObject({ kind: "helper", name: "researcher", title: "Найди цены", input: { task: "Найди цены" }, status: "running" });
    expect(port.helperModel).toHaveBeenCalledWith("researcher", "anna", "chat-1");
    expect(calls[0]).toMatchObject({ name: "researcher", helper: researcher, task: "Найди цены" });
    expect(calls[0]!.priorMessages).toBeUndefined();
  });

  it("после каждого шага шаги и ход сохраняются; итог — done и служебное сообщение с текстом помощника", async () => {
    const { store, background, port, calls } = setup();
    const { taskId } = await callTool(background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    port.emitted.length = 0;
    await calls[0]!.step(2);
    await settle();
    expect(await store.get("anna", taskId)).toMatchObject({ helperMessages: [message(1), message(2)], progress: progress("running", "сделано шагов: 2") });
    expect(port.emitted.filter((event) => event.type === "tasks-changed")).toHaveLength(2);
    calls[0]!.finish({ status: "done", text: "Цены: 100 и 200" });
    await settle();
    expect(await store.get("anna", taskId)).toMatchObject({ status: "done", result: "Цены: 100 и 200", deliveredAt: iso(0) });
    expect(port.delivered[0]!.notices).toEqual([{ kind: "task_done", taskId, title: "Найди цены", result: "Цены: 100 и 200" }]);
  });

  it("помощник не справился — failed с его текстом", async () => {
    const { store, background, port, calls } = setup();
    const { taskId } = await callTool(background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    calls[0]!.finish({ status: "failed", text: "поиск недоступен" });
    await settle();
    expect(await store.get("anna", taskId)).toMatchObject({ status: "failed", error: "поиск недоступен" });
    expect(port.delivered[0]!.notices[0]).toMatchObject({ kind: "task_failed", error: "поиск недоступен" });
  });

  it("после перезапуска продолжает с сохранённых шагов: 3 старых шага идут в priorMessages, новый — четвёртый", async () => {
    const store = memoryTaskStore();
    const first = setup(store);
    const { taskId } = await callTool(first.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    await first.calls[0]!.step(3);
    // Сервер упал: таймеры и запуск пропали, аренда истекла.
    await store.update("anna", taskId, { leaseUntil: iso(-1) });

    const second = setup(store);
    await second.background.recover();
    await settle();
    expect(second.calls[0]!.priorMessages).toEqual([message(1), message(2), message(3)]);
    await second.calls[0]!.step(1);
    second.calls[0]!.finish({ status: "done", text: "готово" });
    await settle();
    expect(await store.get("anna", taskId)).toMatchObject({ status: "done", attempt: 2, helperMessages: [message(1), message(2), message(3), message(4)] });
    await second.background.flush();
  });

  it("помощника больше нет в настройках — после перезапуска failed", async () => {
    const store = memoryTaskStore();
    const first = setup(store);
    const { taskId } = await callTool(first.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    await store.update("anna", taskId, { leaseUntil: iso(-1) });
    const second = createBackgroundTasks({ store });
    second.attach(createFakePort());
    await second.recover();
    await settle();
    expect(await store.get("anna", taskId)).toMatchObject({ status: "failed", error: expect.stringMatching(/researcher/) });
    await second.flush();
  });
});

describe("пауза фонового помощника (T055)", () => {
  const pending = { approvalId: "approval-1", toolName: "send_email", title: "Отправить письмо", input: { to: "boss@example.com" } };

  async function paused(maxRunningPerUser?: number) {
    const context = setup(memoryTaskStore(), maxRunningPerUser);
    const { taskId } = await callTool(context.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    await context.calls[0]!.step(1);
    // Последний шаг перед паузой — с вопросом человеку.
    await context.calls[0]!.onStep({ messages: [message(1)], progress: progress("awaiting_approval", "", { pendingApproval: pending }) });
    context.calls[0]!.finish({ status: "awaiting_approval", text: "" });
    await settle();
    return { ...context, taskId };
  }

  it("пауза — служебное сообщение с подтверждением без пробуждения агента; место в пределе не занимает", async () => {
    const { store, port, taskId } = await paused();
    expect(port.delivered).toEqual([
      {
        ownerId: "anna",
        chatId: "chat-1",
        wakeAgent: false,
        deliveryKey: `task:${taskId}:approval:approval-1`,
        notices: [{ kind: "task_awaiting_approval", taskId, title: "Найди цены", approval: { approvalId: "approval-1", toolName: "send_email", input: { to: "boss@example.com" } } }],
      },
    ]);
    expect(await store.get("anna", taskId)).toMatchObject({ status: "awaiting_approval", helperMessages: [message(1)], deliveredAt: iso(0) });
    expect(await store.countActive("anna")).toBe(0);
  });

  it("answerApproval: шаги с ответом человека, задача продолжается и доставляется", async () => {
    const { store, background, port, calls, taskId } = await paused();
    expect(await background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow")).toBe("resumed");
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.priorMessages).toEqual([message(1), { role: "tool", content: [{ type: "tool-approval-response", approvalId: "approval-1", approved: true }] }]);
    expect(await store.get("anna", taskId)).toMatchObject({ status: "running" });
    calls[1]!.finish({ status: "done", text: "письмо ушло" });
    await settle();
    expect(port.delivered[1]).toMatchObject({ wakeAgent: true, deliveryKey: `task:${taskId}`, notices: [{ kind: "task_done", result: "письмо ушло" }] });
  });

  it("отказ человека передаётся помощнику как approved: false", async () => {
    const { background, calls, taskId } = await paused();
    expect(await background.answerApproval("anna", "chat-1", taskId, "approval-1", "deny")).toBe("resumed");
    await settle();
    expect(calls[1]!.priorMessages!.at(-1)).toEqual({ role: "tool", content: [{ type: "tool-approval-response", approvalId: "approval-1", approved: false }] });
  });

  it("answerApproval: чужой чат, чужой человек, задача не на паузе, повторный ответ — not_found", async () => {
    const { background, taskId } = await paused();
    expect(await background.answerApproval("anna", "chat-other", taskId, "approval-1", "allow")).toBe("not_found");
    expect(await background.answerApproval("boris", "chat-1", taskId, "approval-1", "allow")).toBe("not_found");
    expect(await background.answerApproval("anna", "chat-1", "нет-такой", "approval-1", "allow")).toBe("not_found");
    expect(await background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow")).toBe("resumed");
    expect(await background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow")).toBe("not_found");
  });

  it("ответ на паузе при занятых местах: отказ too_many_tasks, вопрос ждёт; место освободилось — тот же ответ продолжает задачу один раз", async () => {
    const { store, background, calls, taskId } = await paused(1);
    // Пока задача ждала ответа, человек занял единственное место новой задачей.
    const other = await callTool(background.tools(toolsModel({ chatId: "chat-2" })), "helper_researcher", { task: "Второе" });
    expect(other.status).toBe("background");
    await settle();
    expect(calls).toHaveLength(2);

    const refused = await background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TurnRefusedError);
    expect(refused).toMatchObject({ code: "too_many_tasks", message: expect.stringContaining("1") });
    await settle();
    // Задача не потеряна и не продолжена: тот же вопрос ждёт, помощник не запускался, место одно.
    expect(calls).toHaveLength(2);
    expect(await store.get("anna", taskId)).toMatchObject({ status: "awaiting_approval", helperMessages: [message(1)], progress: { pendingApproval: pending } });
    expect(await store.countActive("anna")).toBe(1);

    calls[1]!.finish({ status: "done", text: "второе готово" });
    await settle();
    expect(await store.countActive("anna")).toBe(0);
    expect(await background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow")).toBe("resumed");
    await settle();
    expect(calls).toHaveLength(3);
    expect(calls[2]!.priorMessages).toEqual([message(1), { role: "tool", content: [{ type: "tool-approval-response", approvalId: "approval-1", approved: true }] }]);
    expect(await store.countActive("anna")).toBe(1);
    await background.flush();
  });

  it("ответ и новый запуск одновременно при одном свободном месте: место получает кто-то один", async () => {
    const { store, background, calls, taskId } = await paused(1);
    const [answer, started] = await Promise.all([
      background.answerApproval("anna", "chat-1", taskId, "approval-1", "deny").catch((error: unknown) => error),
      callTool(background.tools(toolsModel({ chatId: "chat-2" })), "helper_researcher", { task: "Второе" }),
    ]);
    await settle();
    const admitted = [answer === "resumed", started.status === "background"].filter(Boolean);
    expect(admitted).toHaveLength(1);
    expect(await store.countActive("anna")).toBe(1);
    expect(calls).toHaveLength(2);
    await background.flush();
  });

  it("задачу, чей ответ отклонён из-за предела, можно отменить", async () => {
    const { store, background, taskId } = await paused(1);
    await callTool(background.tools(toolsModel({ chatId: "chat-2" })), "helper_researcher", { task: "Второе" });
    await settle();
    await expect(background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow")).rejects.toMatchObject({ code: "too_many_tasks" });
    expect(await background.cancel("anna", "chat-1", taskId)).toBe("canceled");
    expect(await store.get("anna", taskId)).toMatchObject({ status: "canceled" });
    await background.flush();
  });

  it("подхват идущей задачи после падения копии место не досчитывает: задача продолжается, предел прежний", async () => {
    const store = memoryTaskStore();
    const first = setup(store, 1);
    const { taskId } = await callTool(first.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    await first.calls[0]!.step(1);
    // Копия упала: аренда истекла, задача по-прежнему занимает своё место.
    await store.update("anna", taskId, { leaseUntil: iso(-1) });
    expect(await store.countActive("anna")).toBe(1);

    const second = setup(store, 1);
    await second.background.recover();
    await settle();
    expect(second.calls).toHaveLength(1);
    expect(await store.get("anna", taskId)).toMatchObject({ status: "running", attempt: 2 });
    expect(await store.countActive("anna")).toBe(1);
    const refused = await callTool(second.background.tools(toolsModel({ chatId: "chat-2" })), "helper_researcher", { task: "Второе" });
    expect(refused.status).toBe("failed");
    expect(await store.countActive("anna")).toBe(1);
    await second.background.flush();
  });
});
