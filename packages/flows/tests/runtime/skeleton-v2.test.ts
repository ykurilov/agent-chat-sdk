import type { AgentToolsModel, StepContextInput } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saying } from "../../../core/tests/unit/support/notice-chat";
import { flowRules } from "../../src/prompt/flow-rules";
import { FLOW_EXTRA_TOOLS, withFlowTools } from "../../src/runtime/flow-tools";
import { withStepTail } from "../../src/runtime/step-tail";
import type { FlowRuntime, PinnedFlow } from "../../src/runtime/flow-events";
import type { AgentFlow } from "../../src/format";
import { fixtureFlow } from "../flow-fixtures";
import { flowChat, newChat, OWNER, say, systemOf } from "./flow-chat";

// T006: каркас модулей этапов 4, 7, 8, 9. Сценарий без новых полей ведёт себя как в 0.48: правила те же байты, хвоста
// нет, инструменты те же; новые возможности — только у сценариев с новыми полями.

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

const examples = ["sales-review", "shop-support", "sheets-lesson"] as const;
const withSchedule = (json: Record<string, any>) => (json.schedule = { dayStart: "09:00" });
const withSideTasks = (json: Record<string, any>) => (json.sideTasks = [{ id: "subscribe", text: "Подписка на канал" }]);

function runtimeOf(flow: AgentFlow | null): FlowRuntime {
  const pinned: PinnedFlow | null = flow && { flowId: flow.id, versionId: "v1", flow };
  return {
    store: {} as FlowRuntime["store"],
    now: () => Date.now(),
    logError: vi.fn(),
    chatFlow: async () => pinned,
    cardValues: async () => ({}),
    afterTransitions: async () => {},
  };
}

const stepInput = (): StepContextInput => ({
  state: {},
  stepNumber: 0,
  chatId: "c1",
  ownerId: OWNER,
  messageId: "a1",
  chat: {},
  channel: "web",
  audience: "private",
  modelId: "m",
  providerId: "p",
  abortSignal: new AbortController().signal,
});

describe("каркас v2: постоянные правила", () => {
  it.each(examples)("%s без новых полей — правила побайтно как в 0.48", (name) => {
    const flow = fixtureFlow(name);
    expect(flowRules(flow.common, flow)).toBe(flowRules(flow.common));
  });

  it("части правил собираются после общих правил и до «Общего для всех состояний»", () => {
    const flow = fixtureFlow("sales-review");
    const rules = flowRules("Цены не называй.", flow, [() => "## Дни\nДень по поясу человека.", () => null]);
    expect(rules).toBe(`${flowRules("")}\n\n## Дни\nДень по поясу человека.\n\n## Общее для всех состояний\nЦены не называй.`);
  });

  it("новые возможности сценария — части этапов: дни и попутные задачи готовы", () => {
    expect(flowRules("", fixtureFlow("sales-review", withSchedule))).toContain("## Дни и время");
    expect(flowRules("", fixtureFlow("sales-review", withSideTasks))).toContain("## Попутные задачи");
  });
});

describe("каркас v2: хвост шага", () => {
  it("без новых полей хвоста нет; хвост приложения — как есть", async () => {
    const runtime = runtimeOf(fixtureFlow("sales-review"));
    expect(await withStepTail(undefined, runtime)(stepInput())).toBeUndefined();
    expect(await withStepTail(() => "Корзина: 2 товара", runtime)(stepInput())).toBe("Корзина: 2 товара");
  });

  it("строки сценария идут после хвоста приложения, пустые пропускаются", async () => {
    const runtime = runtimeOf(fixtureFlow("sales-review", withSchedule));
    const tail = withStepTail(() => "Корзина: 2 товара", runtime, [() => "День 2 из 3.", () => null, () => "Сегодня последний день."]);
    expect(await tail(stepInput())).toBe("Корзина: 2 товара\nДень 2 из 3.\nСегодня последний день.");
  });

  it("в группе и без сценария — только хвост приложения", async () => {
    const parts = [() => "День 2 из 3."];
    expect(await withStepTail(undefined, runtimeOf(null), parts)(stepInput())).toBeUndefined();
    const group = { ...stepInput(), audience: "group" as const };
    expect(await withStepTail(() => "свой", runtimeOf(fixtureFlow("sales-review", withSchedule)), parts)(group)).toBe("свой");
  });
});

describe("каркас v2: служебные инструменты", () => {
  const model = { ownerId: OWNER, chatId: "c1", audience: "private" } as AgentToolsModel;
  const toolNames = (flow: AgentFlow | null) => {
    const runtime = runtimeOf(flow);
    const pinned = flow ? { flowId: flow.id, versionId: "v1", flow } : undefined;
    const tools = withFlowTools(undefined, { runtime, judge: () => ({}) as never, history: async () => [], cardTools: () => ({}), knownFlow: () => pinned });
    return Object.keys(typeof tools === "function" ? tools(model) : tools).sort();
  };

  it("без новых полей — только инструменты 0.48", () => {
    expect(toolNames(fixtureFlow("sales-review"))).toEqual(["flow_exit"]);
    expect(toolNames(null)).toEqual(["flow_exit"]);
  });

  it("«Дни и время» — пояс, «закрыть день» и встроенная задача «узнать город»; попутные задачи — свой инструмент", () => {
    expect(toolNames(fixtureFlow("sales-review", withSchedule))).toEqual(["flow_close_day", "flow_exit", "flow_side_task", "flow_time_zone"]);
    expect(toolNames(fixtureFlow("sales-review", withSideTasks))).toEqual(["flow_exit", "flow_side_task"]);
    expect(FLOW_EXTRA_TOOLS.map((item) => item.name)).toEqual(["flow_time_zone", "flow_close_day", "flow_side_task"]);
  });
});

describe("каркас v2: чат по сценарию 0.48", () => {
  it("ход без новых полей: правила как в 0.48, хвоста и новых инструментов нет", async () => {
    const chat = flowChat({ scripts: [saying("Здравствуйте!"), saying("Понятно.")] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await say(chat.service, id, "курс про Excel");
    await chat.flow.settled();

    const flow = fixtureFlow("sales-review");
    for (const call of chat.model.doStreamCalls) {
      expect(systemOf(call)).toContain(JSON.stringify(flowRules(flow.common)).slice(1, -1));
      expect((call.tools ?? []).map((item) => item.name)).toEqual(["flow_exit"]);
    }
    expect(chat.logError).not.toHaveBeenCalled();
  });

  it("решение о входящем: обычный чат — «отвечать», законченный — «закончен»", async () => {
    const chat = flowChat({ scripts: [saying("Здравствуйте!")] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "answer" });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: "чужой" })).toEqual({ kind: "answer" });
    await chat.store.endChat(id, { reason: "deadline", at: new Date().toISOString() });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "ended", reason: "deadline", afterEnd: "reply" });
  });

  it("доставка — исход неизвестного чата ничего не делает", async () => {
    const chat = flowChat();
    // Этап 7 готов: исход неизвестного чата — ничего.
    await expect(chat.flow.reportDelivery({ chatId: "c1", messageId: "a1", outcome: { status: "delivered" } })).resolves.toBeUndefined();
    chat.flow.attach({ portFor: () => chat.service });
    await expect(chat.flow.readRun(OWNER, "c1")).resolves.toBeNull();
  });
});
