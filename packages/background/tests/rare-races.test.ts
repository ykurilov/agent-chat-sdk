import type { AgentHelper, HelperProgress, RunHelperInput, RunHelperResult } from "@ykurilov/agent-chat-core";
import type { ModelMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks, memoryTaskStore } from "../src/index";
import type { TaskPatch, TaskStore } from "../src/types";
import { callTool, controlledTool, createFakePort, FAKE_TIMERS, settle, toolsModel } from "./support/fake-port";
import type { FakePort } from "./support/fake-port";

/** Редкие гонки копий сервера и сбоев: отмена против итога, сбой между доставкой и отметкой, предел попыток. */
const START = new Date("2026-10-05T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ ...FAKE_TIMERS, now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Хранилище копии поверх общего: перед следующей подходящей записью тест вставляет своё действие. */
function interceptedStore(shared: TaskStore) {
  const hooks: Array<{ when(patch: TaskPatch): boolean; run(): Promise<void> }> = [];
  const ran: Array<Promise<void>> = [];
  let failMarkDelivered = 0;
  const store: TaskStore = {
    ...shared,
    async update(ownerId, taskId, patch, when) {
      const index = hooks.findIndex((hook) => hook.when(patch));
      if (index >= 0) {
        const running = hooks.splice(index, 1)[0]!.run();
        ran.push(running);
        await running;
      }
      return shared.update(ownerId, taskId, patch, when);
    },
    async markDelivered(taskIds, deliveryKey, at) {
      if (failMarkDelivered > 0) {
        failMarkDelivered -= 1;
        throw new Error("сервер упал до отметки о доставке");
      }
      return shared.markDelivered(taskIds, deliveryKey, at);
    },
  };
  return {
    store,
    beforeUpdate(when: (patch: TaskPatch) => boolean, run: () => Promise<void>) {
      hooks.push({ when, run });
    },
    /** Дождаться вставленных действий и того, что за ними. */
    async hooksDone() {
      expect(hooks).toEqual([]);
      await Promise.all(ran);
      await settle();
    },
    failNextMarkDelivered() {
      failMarkDelivered += 1;
    },
  };
}

function toolCopy(shared: TaskStore) {
  const intercepted = interceptedStore(shared);
  const report = controlledTool();
  const background = createBackgroundTasks({ store: intercepted.store, tools: { build_report: report.definition } });
  const port = createFakePort();
  background.attach(port);
  return { ...intercepted, background, port, runs: report.runs };
}

describe("отмена против итога на двух копиях", () => {
  it("человек отменил на другой копии, пока эта пишет итог, — остаётся «отменена», итог не пишется и не доставляется", async () => {
    const shared = memoryTaskStore();
    const a = toolCopy(shared);
    const b = toolCopy(shared);
    const { taskId } = await callTool(a.background.tools(toolsModel()), "build_report", { period: "март" });
    await settle();
    a.beforeUpdate(
      (patch) => patch.status === "done",
      async () => {
        expect(await b.background.cancel("anna", "chat-1", taskId)).toBe("canceled");
        await settle();
      },
    );
    a.runs[0]!.resolve("готово");
    await settle();
    await a.hooksDone();
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "canceled" });
    expect([...a.port.delivered, ...b.port.delivered].map((item) => item.notices.map((notice) => notice.kind))).toEqual([["task_canceled"]]);
  });

  it("итог записан раньше отмены с другой копии — отмена отвечает already_finished и итог не трогает", async () => {
    const shared = memoryTaskStore();
    const a = toolCopy(shared);
    const b = toolCopy(shared);
    const { taskId } = await callTool(a.background.tools(toolsModel()), "build_report", { period: "март" });
    await settle();
    b.beforeUpdate(
      (patch) => patch.status === "canceled",
      async () => {
        a.runs[0]!.resolve("готово");
        await settle();
      },
    );
    expect(await b.background.cancel("anna", "chat-1", taskId)).toBe("already_finished");
    await b.hooksDone();
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "done", result: "готово" });
    expect([...a.port.delivered, ...b.port.delivered].map((item) => item.notices.map((notice) => notice.kind))).toEqual([["task_done"]]);
  });
});

describe("сбой между доставкой и отметкой о доставке", () => {
  it("набор итогов за это время вырос — уже доставленный итог не приходит второй раз", async () => {
    const shared = memoryTaskStore();
    const a = toolCopy(shared);
    const first = await callTool(a.background.tools(toolsModel()), "build_report", { period: "март" });
    const second = await callTool(a.background.tools(toolsModel()), "build_report", { period: "апрель" });
    await settle();
    a.failNextMarkDelivered();
    a.runs[0]!.resolve("март готов");
    await settle();
    expect(a.port.errors).toHaveLength(1);
    a.runs[1]!.resolve("апрель готов");
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    // `delivered` — что записало бы ядро: повтор с тем же ключом оно пропускает.
    const noticesOf = (taskId: string) => a.port.delivered.flatMap((item) => item.notices).filter((notice) => notice.taskId === taskId);
    expect(noticesOf(first.taskId)).toHaveLength(1);
    expect(noticesOf(second.taskId)).toHaveLength(1);
    for (const taskId of [first.taskId, second.taskId]) expect((await shared.get("anna", taskId))?.deliveredAt).toBeDefined();
  });
});

const researcher: AgentHelper = {
  description: "Ищет сведения в сети",
  instructions: "Ищи и пиши коротко",
  model: { providerId: "fake", modelId: "fake-model" },
  background: true,
};
const pausedProgress = (approvalId: string): HelperProgress => ({
  task: "Найди цены",
  steps: [],
  text: "",
  status: "awaiting_approval",
  pendingApproval: { approvalId, toolName: "send_email", title: "Отправить письмо", input: {} },
});

/** Помощник: на каждом запуске просит подтверждение (`pause`), висит до отмены (`hang`) или заканчивает (`finish`). */
function pausingHelper() {
  const calls: RunHelperInput[] = [];
  let mode: "pause" | "hang" | "finish" = "pause";
  const runHelper = async (input: RunHelperInput): Promise<RunHelperResult> => {
    calls.push(input);
    const messages: ModelMessage[] = [...(input.priorMessages ?? []), { role: "assistant", content: `шаг ${calls.length}` }];
    if (mode === "finish") return { status: "done", text: "готово", messages };
    if (mode === "hang") {
      return new Promise((_, reject) => input.abortSignal.addEventListener("abort", () => reject(input.abortSignal.reason)));
    }
    await input.onStep({ messages, progress: pausedProgress(`approval-${calls.length}`) });
    return { status: "awaiting_approval", text: "", messages };
  };
  return {
    calls,
    runHelper,
    next(next: typeof mode) {
      mode = next;
    },
  };
}

function helperCopy(shared: TaskStore, helper: ReturnType<typeof pausingHelper>) {
  const intercepted = interceptedStore(shared);
  const background = createBackgroundTasks({ store: intercepted.store });
  const port = createFakePort({ helpers: { researcher }, runHelper: helper.runHelper });
  background.attach(port);
  return { ...intercepted, background, port };
}

describe("продолжения после подтверждения", () => {
  it("не считаются попытками: после трёх подтверждений и падения сервера помощник продолжает, а не «прерван»", async () => {
    const shared = memoryTaskStore();
    const helper = pausingHelper();
    const a = helperCopy(shared, helper);
    const { taskId } = await callTool(a.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    for (let answer = 0; answer < 3; answer += 1) {
      expect(await a.background.answerApproval("anna", "chat-1", taskId, approvalOf(answer + 1), "allow")).toBe("resumed");
      await settle();
    }
    expect(helper.calls).toHaveLength(4);
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "awaiting_approval", attempt: 1 });
    // Последнее подтверждение — и сервер падает посреди работы помощника.
    helper.next("hang");
    expect(await a.background.answerApproval("anna", "chat-1", taskId, "approval-4", "allow")).toBe("resumed");
    await settle();
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "running", attempt: 1 });
    await a.background.flush();
    // Перезапуск занимает время: аренда остановленной копии успевает истечь.
    await vi.advanceTimersByTimeAsync(1);
    helper.next("finish");
    const b = helperCopy(shared, helper);
    await b.background.recover();
    await settle();
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "done", attempt: 2 });
    expect(b.port.delivered.at(-1)?.notices).toEqual([expect.objectContaining({ kind: "task_done", result: "готово" })]);
  });

  it("подтверждение пришло на две копии сразу — помощник продолжает один раз", async () => {
    const shared = memoryTaskStore();
    const helper = pausingHelper();
    const a = helperCopy(shared, helper);
    const b = helperCopy(shared, helper);
    const { taskId } = await callTool(a.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    // После ответа помощник работает дальше и нового вопроса пока не задаёт.
    helper.next("hang");
    let fromB: string | undefined;
    a.beforeUpdate(
      // Перед записью продолжения: ответ человека уже в истории помощника.
      (patch) => patch.helperMessages !== undefined && patch.status === "running",
      async () => {
        fromB = await b.background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow");
        await settle();
      },
    );
    const fromA = await a.background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow");
    await a.hooksDone();
    expect([fromA, fromB].sort()).toEqual(["not_found", "resumed"]);
    expect(helper.calls).toHaveLength(2);
    await Promise.all([a.background.flush(), b.background.flush()]);
  });

  it("опоздавший ответ на старый вопрос не одобряет новый: stale, помощник ждёт ответа на новый", async () => {
    const shared = memoryTaskStore();
    const helper = pausingHelper();
    const a = helperCopy(shared, helper);
    const { taskId } = await callTool(a.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    expect(await a.background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow")).toBe("resumed");
    await settle();
    // Помощник задал второй вопрос; ответ на первый пришёл с опозданием (вторая вкладка, кнопка в мессенджере).
    expect((await shared.get("anna", taskId))?.progress?.pendingApproval?.approvalId).toBe("approval-2");
    expect(await a.background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow")).toBe("stale");
    await settle();
    expect(helper.calls).toHaveLength(2);
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "awaiting_approval", progress: { pendingApproval: { approvalId: "approval-2" } } });
    expect(await a.background.answerApproval("anna", "chat-1", taskId, "approval-2", "deny")).toBe("resumed");
    await a.background.flush();
  });

  it("гонка: пока копия пишет ответ на первый вопрос, другая ответила и помощник задал второй — запись не проходит, stale", async () => {
    const shared = memoryTaskStore();
    const helper = pausingHelper();
    const a = helperCopy(shared, helper);
    const b = helperCopy(shared, helper);
    const { taskId } = await callTool(a.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" });
    await settle();
    let fromB: string | undefined;
    a.beforeUpdate(
      (patch) => patch.helperMessages !== undefined && patch.status === "running",
      async () => {
        // Копия B ответила на тот же вопрос, помощник продолжил и снова встал на паузу — уже с другим вопросом.
        fromB = await b.background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow");
        await settle();
        expect(await shared.get("anna", taskId)).toMatchObject({ status: "awaiting_approval", progress: { pendingApproval: { approvalId: "approval-2" } } });
      },
    );
    const fromA = await a.background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow");
    await a.hooksDone();
    expect(fromB).toBe("resumed");
    expect(fromA).toBe("stale");
    expect(helper.calls).toHaveLength(2);
    const task = await shared.get("anna", taskId);
    expect(task).toMatchObject({ status: "awaiting_approval", progress: { pendingApproval: { approvalId: "approval-2" } } });
    // В истории помощника один ответ человека — от копии B.
    const answers = (task?.helperMessages ?? []).filter((message) => message.role === "tool");
    expect(answers).toHaveLength(1);
    await Promise.all([a.background.flush(), b.background.flush()]);
  });
});

const approvalOf = (n: number) => `approval-${n}`;

/** Доставка первой пачки долгая: пока ядро пишет служебное сообщение, тест вставляет своё действие. */
function duringFirstDelivery(port: FakePort, run: () => Promise<void>): () => Promise<void> {
  const original = port.deliverNotices.bind(port);
  let ran: Promise<void> | undefined;
  port.deliverNotices = async (input) => {
    const result = await original(input);
    if (!ran) {
      ran = run();
      await ran;
    }
    return result;
  };
  return async () => {
    expect(ran).toBeDefined();
    await ran;
    await settle();
  };
}

describe("ответ человека против долгой доставки «ждёт подтверждения»", () => {
  it("«Разрешить» во время доставки — задача в работе, аренда продлевается, отметка о доставке не легла", async () => {
    const shared = memoryTaskStore();
    const helper = pausingHelper();
    const a = helperCopy(shared, helper);
    const b = helperCopy(shared, helper);
    let taskId = "";
    const done = duringFirstDelivery(a.port, async () => {
      helper.next("hang");
      expect(await b.background.answerApproval("anna", "chat-1", taskId, "approval-1", "allow")).toBe("resumed");
    });
    ({ taskId } = await callTool(a.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" }));
    await settle();
    await done();
    const task = await shared.get("anna", taskId);
    expect(task).toMatchObject({ status: "running" });
    expect(task).not.toHaveProperty("deliveredAt");
    expect(task?.leaseOwner).toBeDefined();
    // Копия B продолжает держать задачу: аренда не потеряна, запуск не оборван.
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "running", leaseOwner: task?.leaseOwner });
    expect(helper.calls).toHaveLength(2);
    await Promise.all([a.background.flush(), b.background.flush()]);
  });

  it("«Отменить» во время доставки — пометка «отменена» доходит до чата", async () => {
    const shared = memoryTaskStore();
    const helper = pausingHelper();
    const a = helperCopy(shared, helper);
    const b = helperCopy(shared, helper);
    let taskId = "";
    const done = duringFirstDelivery(a.port, async () => {
      // У копии B чат пока занят: пометку «отменена» она доставит, когда ход закончится, — уже после отметки копии A.
      b.port.chatState.set("chat-1", "busy");
      expect(await b.background.cancel("anna", "chat-1", taskId)).toBe("canceled");
      await settle();
    });
    ({ taskId } = await callTool(a.background.tools(toolsModel()), "helper_researcher", { task: "Найди цены" }));
    await settle();
    await done();
    b.port.finishTurn("anna", "chat-1");
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    const kinds = [...a.port.delivered, ...b.port.delivered].flatMap((item) => item.notices.map((notice) => notice.kind));
    expect(kinds).toEqual(["task_awaiting_approval", "task_canceled"]);
    expect(await shared.get("anna", taskId)).toMatchObject({ status: "canceled", deliveredAt: expect.any(String) });
    await Promise.all([a.background.flush(), b.background.flush()]);
  });
});
