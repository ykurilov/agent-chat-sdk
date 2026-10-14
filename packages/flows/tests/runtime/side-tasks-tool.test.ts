import type { AgentToolsModel, AppStateAccess } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, saying } from "../../../core/tests/unit/support/notice-chat";
import { FLOW_STATE_KEY, type FlowRun } from "../../src/engine/flow-run";
import { startRun } from "../../src/engine/run-updates";
import type { AgentFlow } from "../../src/format/flow-format";
import { flowRules } from "../../src/prompt/flow-rules";
import { sideTaskRules } from "../../src/prompt/rules/side-tasks";
import type { FlowRuntime } from "../../src/runtime/flow-events";
import { FLOW_SIDE_TASK_TOOL, sideTaskTool } from "../../src/runtime/side-task-tool";
import { sideTasksLine } from "../../src/runtime/tail/side-tasks-line";
import { memoryFlowStore } from "../../src/store/memory";
import { fixtureFlow } from "../flow-fixtures";
import { flowChat, newChat, OWNER, say, systemOf, toolOutput } from "./flow-chat";

// T904: попутные задачи на деле — инструмент flow_side_task, строка хвоста с открытыми задачами, правило в инструкции.

const NOW = Date.UTC(2026, 9, 14, 10);

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) }));
afterEach(() => vi.useRealTimers());

const subscribe = { id: "subscribe", text: "Предложи подписаться на канал @expert", when: "когда человек получил результат" };
const review = { id: "review", text: "Попроси короткий отзыв", perConversation: true };
const withTasks =
  (...tasks: Record<string, unknown>[]) =>
  (json: Record<string, any>) => {
    json.sideTasks = tasks;
  };

function setup(edit: (json: Record<string, any>) => void = withTasks(subscribe, review), options: { staff?: boolean; card?: Record<string, unknown> } = {}) {
  const flow: AgentFlow = fixtureFlow("sales-review", edit);
  const store = memoryFlowStore();
  const card = { ...options.card };
  const runtime: FlowRuntime = {
    store,
    now: () => NOW,
    logError: vi.fn(),
    chatFlow: async () => ({ flowId: "sales-review", versionId: "v1", flow }),
    cardValues: async () => card,
    afterTransitions: async () => {},
  };
  const values: Record<string, unknown> = { [FLOW_STATE_KEY]: startRun(flow, NOW) };
  const state: AppStateAccess = {
    get: (path) => (path === undefined ? { ...values } : values[path]),
    set: (path, value) => void (values[path] = structuredClone(value)),
    unset: (path) => void delete values[path],
  };
  const model = (chatId: string) => ({ ownerId: OWNER, chatId, state, ...(options.staff && { staff: { id: "admin" } }) }) as unknown as AgentToolsModel;
  const call = async (input: unknown, chatId = "c1") => {
    const tool = sideTaskTool.make({ runtime, model: model(chatId) });
    return String(await tool.execute!(input as never, { toolCallId: "t1", messages: [], context: {} }));
  };
  const run = () => values[FLOW_STATE_KEY] as FlowRun;
  const records = async (chatId = "c1") => store.readSideTasks(OWNER, chatId);
  const tail = (chatId = "c1", patch: Partial<FlowRun> = {}) => sideTasksLine({ ownerId: OWNER, chatId, flow, run: { ...run(), ...patch }, now: NOW, runtime });
  return { flow, store, runtime, values, card, call, run, records, tail };
}

describe("flow_side_task: предложил", () => {
  it("попытка записывается на человека; ответ говорит, какая это попытка", async () => {
    const s = setup();
    const answer = await s.call({ id: "subscribe", status: "asked" });

    expect(answer).toContain("1 из 2");
    expect(await s.records()).toEqual([{ taskId: "subscribe", chatId: null, asks: 1, doneAt: null }]);
  });

  it("«заново в каждом разговоре»: попытка записывается на этот разговор", async () => {
    const s = setup();
    await s.call({ id: "review", status: "asked" }, "c1");

    expect(await s.records("c1")).toEqual([{ taskId: "review", chatId: "c1", asks: 1, doneAt: null }]);
    expect(await s.records("c2")).toEqual([]);
  });

  it("темп общий с вопросами между делом: отсчёт идёт с этого сообщения", async () => {
    const s = setup();
    s.values[FLOW_STATE_KEY] = { ...startRun(s.flow, NOW), humanMessages: 7 };
    await s.call({ id: "subscribe", status: "asked" });

    expect(s.run().sideQuestionAt).toBe(7);
  });

  it("третья попытка не записывается: «больше не предлагай»", async () => {
    const s = setup();
    await s.call({ id: "subscribe", status: "asked" });
    await s.call({ id: "subscribe", status: "asked" });
    const answer = await s.call({ id: "subscribe", status: "asked" });

    expect(answer).toMatch(/больше не предлагай/i);
    expect((await s.records())[0]!.asks).toBe(2);
  });

  it("попытки на человека видны из другого разговора", async () => {
    const s = setup();
    await s.call({ id: "subscribe", status: "asked" }, "c1");
    await s.call({ id: "subscribe", status: "asked" }, "c1");

    expect(await s.call({ id: "subscribe", status: "asked" }, "c2")).toMatch(/больше не предлагай/i);
  });

  it("решённую задачу не предлагают", async () => {
    const s = setup();
    await s.call({ id: "subscribe", status: "done" });
    const answer = await s.call({ id: "subscribe", status: "asked" });

    expect(answer).toMatch(/уже решена/i);
    expect((await s.records())[0]!.asks).toBe(0);
  });

  it("такой задачи нет — подсказка с задачами сценария, ничего не записано", async () => {
    const s = setup();
    const answer = await s.call({ id: "unknown", status: "asked" });

    expect(answer).toContain("subscribe");
    expect(answer).toContain("review");
    expect(await s.records()).toEqual([]);
  });
});

describe("flow_side_task: решена", () => {
  it("задача без поля: решена, когда агент так отметил", async () => {
    const s = setup();
    await s.call({ id: "subscribe", status: "asked" });
    const answer = await s.call({ id: "subscribe", status: "done" });

    expect(answer).toMatch(/решена/i);
    const [record] = await s.records();
    expect(record!.asks).toBe(1);
    expect(record!.doneAt).toBe(new Date(NOW).toISOString());
  });

  it("человек выполнил сам, без вопроса: done без asked — тоже решена; повтор безвреден", async () => {
    const s = setup();
    await s.call({ id: "subscribe", status: "done" });
    await s.call({ id: "subscribe", status: "done" });

    expect((await s.records()).map((record) => [record.taskId, record.asks, record.doneAt !== null])).toEqual([["subscribe", 0, true]]);
  });

  it("done не трогает темп: вопроса между делом не было", async () => {
    const s = setup();
    await s.call({ id: "subscribe", status: "done" });
    expect(s.run().sideQuestionAt).toBeNull();
  });

  it("задача с полем: пока поле не записано, done отказывает и просит flow_note", async () => {
    const s = setup(withTasks({ id: "ask_audience", text: "Узнай аудиторию", field: "audience" }));
    const answer = await s.call({ id: "ask_audience", status: "done" });

    expect(answer).toContain("flow_note");
    expect(answer).toContain("Аудитория");
    expect((await s.records()).every((record) => record.doneAt === null)).toBe(true);
  });

  it("задача с полем: поле известно — done принимается", async () => {
    const s = setup(withTasks({ id: "ask_audience", text: "Узнай аудиторию", field: "audience" }), { card: { audience: "Новички" } });
    await s.call({ id: "ask_audience", status: "done" });

    expect((await s.records())[0]!.doneAt).not.toBeNull();
  });
});

describe("flow_side_task: ход сотрудника", () => {
  it("сотрудник попытки человека не меняет", async () => {
    const s = setup(undefined, { staff: true });
    const answer = await s.call({ id: "subscribe", status: "asked" });

    expect(answer).toMatch(/не отмечено/i);
    expect(await s.records()).toEqual([]);
    expect(s.run().sideQuestionAt).toBeNull();
  });
});

describe("хвост шага: открытые попутные задачи", () => {
  it("сценарий без попутных задач — строки нет", async () => {
    const s = setup(() => {});
    expect(await s.tail()).toBeNull();
  });

  it("открытые задачи — по строке: id, что сделать, когда уместно, сколько попыток осталось", async () => {
    const s = setup();
    const line = (await s.tail())!;

    expect(line).toContain("subscribe");
    expect(line).toContain("Предложи подписаться на канал @expert");
    expect(line).toContain("когда человек получил результат");
    expect(line).toContain("review");
    expect(line).toContain("Попроси короткий отзыв");
    expect(line).toContain(FLOW_SIDE_TASK_TOOL);
    expect(line).toMatch(/2/);
  });

  it("после первой попытки показывает, что осталась одна", async () => {
    const s = setup(withTasks(subscribe));
    await s.call({ id: "subscribe", status: "asked" });
    s.values[FLOW_STATE_KEY] = { ...s.run(), humanMessages: 20 };

    expect(await s.tail()).toMatch(/осталась 1 попытка/);
  });

  it("израсходованные и решённые задачи из строки уходят; открытых нет — строки нет", async () => {
    const s = setup();
    await s.call({ id: "subscribe", status: "asked" });
    await s.call({ id: "subscribe", status: "asked" });
    await s.call({ id: "review", status: "done" });
    s.values[FLOW_STATE_KEY] = { ...s.run(), humanMessages: 50 };

    expect(await s.tail()).toBeNull();
  });

  it("пока не прошёл общий темп с вопросами между делом — строки нет, потом снова есть", async () => {
    const s = setup(withTasks(subscribe));
    s.values[FLOW_STATE_KEY] = { ...startRun(s.flow, NOW), humanMessages: 4, sideQuestionAt: 4 };
    expect(await s.tail()).toBeNull();
    expect(await s.tail("c1", { humanMessages: 4 + s.flow.pace.sideQuestionEveryMessages })).toContain("subscribe");
  });

  it("задача с полем, которое уже известно, не показывается", async () => {
    const s = setup(withTasks({ id: "ask_audience", text: "Узнай аудиторию", field: "audience" }), { card: { audience: "Новички" } });
    expect(await s.tail()).toBeNull();
  });

  it("одинаковые входные данные — одинаковая строка (кэш запроса не дрожит)", async () => {
    const s = setup();
    expect(await s.tail()).toBe(await s.tail());
  });

  it("в тестовом чате без хранилища (подделка рантайма) хвост не падает и молчит", async () => {
    const s = setup();
    const line = await sideTasksLine({ ownerId: OWNER, chatId: "c1", flow: s.flow, run: s.run(), now: NOW });
    expect(line).toBeNull();
  });

  it("ход сотрудника: задачи ему не предлагаются", async () => {
    const s = setup();
    expect(await sideTasksLine({ ownerId: OWNER, chatId: "c1", flow: s.flow, run: s.run(), now: NOW, runtime: s.runtime, staff: true })).toBeNull();
  });
});

describe("постоянное правило о попутных задачах", () => {
  it("без задач — правила нет; с задачами — как пользоваться инструментом", () => {
    expect(sideTaskRules(fixtureFlow("sales-review"))).toBeNull();
    const text = sideTaskRules(fixtureFlow("sales-review", withTasks(subscribe)))!;
    expect(text).toContain(FLOW_SIDE_TASK_TOOL);
    expect(text).toMatch(/между делом/i);
    expect(text).toMatch(/отказ|не настаивай/i);
  });

  it("не зависит от самих задач и их числа: инструкция под кэш не меняется при правке задачи", () => {
    const one = sideTaskRules(fixtureFlow("sales-review", withTasks(subscribe)));
    const other = sideTaskRules(fixtureFlow("sales-review", withTasks({ id: "x", text: "Совсем другое", maxAttempts: 5 }, review)));
    expect(other).toBe(one);
  });

  it("входит в постоянные правила сценария", () => {
    const flow = fixtureFlow("sales-review", withTasks(subscribe));
    expect(flowRules(flow.common, flow)).toContain(sideTaskRules(flow)!);
  });
});

describe("в живом ходе", () => {
  const edit = (json: Record<string, any>) => withTasks(subscribe)(json);

  it("задача видна в запросе, пока открыта; предложил — отмечено в хранилище; следующий ход (рано) без неё", async () => {
    const chat = flowChat({
      edit,
      scripts: [callTool(FLOW_SIDE_TASK_TOOL, "s1", { id: "subscribe", status: "asked" }), saying("Кстати, подпишитесь на канал!"), saying("Понятно.")],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Спасибо, всё получилось");
    expect(JSON.stringify(chat.model.doStreamCalls[0]!.prompt)).toContain("Предложи подписаться на канал @expert");
    expect(toolOutput(chat.model.doStreamCalls[1]!, "s1")).toContain("1 из 2");
    expect(await chat.store.readSideTasks(OWNER, id)).toEqual([{ taskId: "subscribe", chatId: null, asks: 1, doneAt: null }]);

    await say(chat.service, id, "Хорошо");
    const second = chat.model.doStreamCalls.at(-1)!;
    expect(JSON.stringify(second.prompt)).not.toContain("Предложи подписаться на канал @expert");
  });

  it("постоянная инструкция одна и та же в обоих ходах (задачи живут в хвосте, а не в инструкции)", async () => {
    const chat = flowChat({
      edit,
      scripts: [callTool(FLOW_SIDE_TASK_TOOL, "s1", { id: "subscribe", status: "asked" }), saying("Подпишитесь!"), saying("Понятно.")],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Спасибо");
    await say(chat.service, id, "Хорошо");

    const [first, , last] = chat.model.doStreamCalls;
    expect(systemOf(first!)).toBe(systemOf(last!));
    expect(systemOf(first!)).not.toContain("Предложи подписаться на канал @expert");
    expect((first!.tools ?? []).map((item) => item.name)).toContain(FLOW_SIDE_TASK_TOOL);
  });
});

// В1: встроенная попутная задача «узнать город». Признак `askTimeZone` приходит в вход строки хвоста от этапа 4.
describe("встроенная задача: узнать город", () => {
  const scheduled = (json: Record<string, any>) => (json.schedule = { dayStart: "09:00", lateStartHours: 3, farewellOnDeadline: false });
  const line = (s: ReturnType<typeof setup>, askTimeZone: boolean | undefined, chatId = "c1") =>
    sideTasksLine({ ownerId: OWNER, chatId, flow: s.flow, run: s.run(), now: NOW, runtime: s.runtime, ...(askTimeZone !== undefined && { askTimeZone }) });

  it("пояс неизвестен, первый день — в хвосте задача первой, с живой фразой и именем инструмента пояса", async () => {
    const s = setup((json) => {
      scheduled(json);
      withTasks(subscribe)(json);
    });
    const text = (await line(s, true))!;

    expect(text).toContain("ask_time_zone");
    expect(text).toContain("Кстати, вы откуда? Хочу писать вам в удобное время");
    expect(text).toContain("flow_time_zone");
    expect(text.indexOf("ask_time_zone")).toBeLessThan(text.indexOf("subscribe"));
  });

  it("признака нет — строки про город нет (и строки вовсе нет, если своих задач тоже нет)", async () => {
    const s = setup(scheduled);
    expect(await line(s, false)).toBeNull();
    expect(await line(s, undefined)).toBeNull();
  });

  it("ход сотрудника город не спрашивает", async () => {
    const s = setup(scheduled, { staff: true });
    expect(await sideTasksLine({ ownerId: OWNER, chatId: "c1", flow: s.flow, run: s.run(), now: NOW, runtime: s.runtime, staff: true, askTimeZone: true })).toBeNull();
  });

  it("инструмент есть и у сценария с «Днями и временем» без своих задач: предложил — попытка на человека, темп сдвигается", async () => {
    const s = setup(scheduled);
    expect(sideTaskTool.wanted(s.flow)).toBe(true);
    s.values[FLOW_STATE_KEY] = { ...startRun(s.flow, NOW), humanMessages: 3 };
    const answer = await s.call({ id: "ask_time_zone", status: "asked" });

    expect(answer).toContain("1 из 2");
    expect(await s.records("c1")).toEqual([{ taskId: "ask_time_zone", chatId: null, asks: 1, doneAt: null }]);
    expect(await s.records("c2")).toEqual([{ taskId: "ask_time_zone", chatId: null, asks: 1, doneAt: null }]);
    expect(s.run().sideQuestionAt).toBe(3);
  });

  it("третья попытка не записывается", async () => {
    const s = setup(scheduled);
    await s.call({ id: "ask_time_zone", status: "asked" });
    await s.call({ id: "ask_time_zone", status: "asked" });
    expect(await s.call({ id: "ask_time_zone", status: "asked" })).toMatch(/больше не предлагай/i);
  });

  it("постоянное правило о попутных задачах есть и у сценария только с «Днями и временем»", () => {
    const s = setup(scheduled);
    expect(sideTaskRules(s.flow)).toContain("## Попутные задачи");
  });

  it("без «Дней и времени» и без задач — инструмента и правила нет, как в 0.48", () => {
    const s = setup(() => {});
    expect(sideTaskTool.wanted(s.flow)).toBe(false);
    expect(sideTaskRules(s.flow)).toBeNull();
  });
});
