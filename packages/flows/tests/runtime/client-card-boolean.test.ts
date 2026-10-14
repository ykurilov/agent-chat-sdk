import type { AgentToolsModel, AppStateAccess } from "@ykurilov/agent-chat-core";
import type { Tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, noticeService, saying, scriptedModel } from "../../../core/tests/unit/support/notice-chat";
import { mockModelId } from "../../../core/tests/unit/support/mock-model";
import { dataConditionHolds, parseBooleanAnswer } from "../../src/engine/data-conditions";
import { FLOW_STATE_KEY } from "../../src/engine/flow-run";
import { startRun } from "../../src/engine/run-updates";
import type { AgentFlow } from "../../src/format/flow-format";
import { clientCardBlock, fieldValueText } from "../../src/prompt/client-card-block";
import { createClientCard } from "../../src/runtime/client-card";
import type { CardToolsTurn } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import { fixtureFlow, fixtureJson } from "../flow-fixtures";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { fakeJudge, fakeTimers, newChat, OWNER, runOf, say } from "./flow-chat";

// T903: поле «да/нет» — агент пишет «да» или «нет», хранится true/false, условие «= да», в блоке и ответах — «да»/«нет».

const NOW = Date.UTC(2026, 9, 14, 10);

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) }));
afterEach(() => vi.useRealTimers());

const withSubscribed = (json: Record<string, any>) =>
  json.clientCard.push({ id: "subscribed", name: "Подписан на канал", type: "boolean", about: "Подписан ли человек на канал эксперта." });

describe("разбор ответа «да/нет»", () => {
  it.each([
    ["да", true],
    ["  Да ", true],
    ["ДА.", true],
    ["yes", true],
    ["true", true],
    [true, true],
    ["нет", false],
    ["Нет!", false],
    ["no", false],
    ["false", false],
    [false, false],
  ])("%j → %j", (raw, expected) => {
    expect(parseBooleanAnswer(raw)).toBe(expected);
  });

  it.each([["может быть"], [""], ["   "], [1], [0], [null], [undefined], ["да нет"]])("%j — не ответ", (raw) => {
    expect(parseBooleanAnswer(raw)).toBeUndefined();
  });
});

describe("условия по полю «да/нет»", () => {
  const holds = (op: "filled" | "eq" | "ne", value: boolean | undefined, known: unknown) => dataConditionHolds({ type: "data", field: "subscribed", op, value }, "boolean", known);

  it("= да и = нет", () => {
    expect(holds("eq", true, true)).toBe(true);
    expect(holds("eq", true, false)).toBe(false);
    expect(holds("eq", false, false)).toBe(true);
  });

  it("≠ да — это «нет», но не «неизвестно»", () => {
    expect(holds("ne", true, false)).toBe(true);
    expect(holds("ne", true, true)).toBe(false);
    expect(holds("ne", true, undefined)).toBe(false);
    expect(holds("ne", true, "да")).toBe(false);
  });

  it("«узнали»: и «да», и «нет» — известно; текст «да» вместо true — нет", () => {
    expect(holds("filled", undefined, true)).toBe(true);
    expect(holds("filled", undefined, false)).toBe(true);
    expect(holds("filled", undefined, "да")).toBe(false);
  });
});

describe("значение «да/нет» словами", () => {
  it("true — «да», false — «нет»; остальное, как было", () => {
    expect(fieldValueText(true)).toBe("да");
    expect(fieldValueText(false)).toBe("нет");
    expect(fieldValueText(" Ольга ")).toBe("Ольга");
    expect(fieldValueText(120)).toBe("120");
  });
});

describe("flow_note пишет «да/нет»", () => {
  function setup() {
    const flow: AgentFlow = fixtureFlow("sales-review", withSubscribed);
    const store = memoryFlowStore();
    const card = createClientCard(store, () => new Date(NOW));
    const values: Record<string, unknown> = { [FLOW_STATE_KEY]: startRun(flow, NOW) };
    const state: AppStateAccess = {
      get: (path) => (path === undefined ? { ...values } : values[path]),
      set: (path, value) => void (values[path] = structuredClone(value)),
      unset: (path) => void delete values[path],
    };
    const tools = (): Record<string, Tool> => {
      const model = { ownerId: OWNER, chatId: "c1", state } as unknown as AgentToolsModel;
      const turn: CardToolsTurn = { model, flow: async () => ({ flowId: "sales-review", versionId: "v1", flow }) };
      return typeof card.tools === "function" ? card.tools(turn) : card.tools;
    };
    const call = async (name: string, input: unknown) => String(await tools()[name]!.execute!(input as never, { toolCallId: "t1", messages: [], context: {} }));
    const stored = async () => (await store.readCard(OWNER)).map((entry) => [entry.fieldId, entry.value]);
    return { flow, store, card, call, stored };
  }

  it("«да» → true; в ответе агенту — «да», не «true»", async () => {
    const s = setup();
    const answer = await s.call("flow_note", { field: "subscribed", value: "да" });

    expect(await s.stored()).toEqual([["subscribed", true]]);
    expect(answer).toBe("Записано: «Подписан на канал» = да.");
  });

  it("«Нет» → false, и это известное значение: хранится", async () => {
    const s = setup();
    await s.call("flow_note", { field: "subscribed", value: "Нет" });
    expect(await s.stored()).toEqual([["subscribed", false]]);
  });

  it("логическое значение модели тоже принимается", async () => {
    const s = setup();
    await s.call("flow_note", { field: "subscribed", value: true });
    expect(await s.stored()).toEqual([["subscribed", true]]);
  });

  it("новое «нет» заменяет старое «да»", async () => {
    const s = setup();
    await s.call("flow_note", { field: "subscribed", value: "да" });
    await s.call("flow_note", { field: "subscribed", value: "нет" });
    expect(await s.stored()).toEqual([["subscribed", false]]);
  });

  it("не «да» и не «нет» — не записано, подсказка с вариантами", async () => {
    const s = setup();
    const answer = await s.call("flow_note", { field: "subscribed", value: "может быть" });

    expect(answer).toMatch(/не записано/i);
    expect(answer).toMatch(/да.*нет/);
    expect(await s.stored()).toEqual([]);
  });

  it("client_card show: «нет» показывается словом", async () => {
    const s = setup();
    await s.call("flow_note", { field: "subscribed", value: "нет" });
    expect(await s.call("client_card", { action: "show" })).toContain("Подписан на канал: нет");
  });
});

describe("блок карточки с полем «да/нет»", () => {
  const flow = fixtureFlow("sales-review", withSubscribed);
  const block = (card: Array<{ fieldId: string; value: unknown }>) =>
    clientCardBlock({
      flow,
      run: startRun(flow, NOW),
      card: card.map((entry) => ({ ...entry, updatedAt: new Date(NOW).toISOString(), chatId: "c1", flowId: "sales-review" })),
      now: NOW,
    });

  it("«да» и «нет» — словами", () => {
    expect(block([{ fieldId: "subscribed", value: true }])).toContain("- Подписан на канал: да");
    expect(block([{ fieldId: "subscribed", value: false }])).toContain("- Подписан на канал: нет");
  });

  it("текст вместо true/false — поле неизвестно: не показывается", () => {
    expect(block([{ fieldId: "subscribed", value: "да" }])).not.toContain("Подписан на канал:");
  });
});

describe("переход по полю «да/нет» в живом ходе", () => {
  function booleanChat(scripts: Parameters<typeof scriptedModel>[0], operator: "eq" | "ne", expected: boolean) {
    const json = fixtureJson("sales-review");
    withSubscribed(json);
    json.states.find((state: { id: string }) => state.id === "intro").exits.unshift({
      id: "intro_subscribed",
      when: { type: "data", field: "subscribed", op: operator, value: expected },
      to: "offer",
    });
    const store = memoryFlowStore();
    const { judge } = fakeJudge();
    const flow = buildAgentFlow(
      { loadFlow: async () => ({ flowId: "sales-review", versionId: "v1", flow: json }), store, judge: { fallback: { modelId: mockModelId, providerId: "mock" } } },
      { judge, timers: fakeTimers(), clientCard: createClientCard(store, () => new Date()) },
    );
    const { service } = noticeService(scriptedModel(scripts), flow.withChat({ agent: { instructions: "Ты помощник." } }));
    flow.attach(service);
    return { service, store };
  }

  it("flow_note «да» → условие «= да» срабатывает в том же ответе", async () => {
    const chat = booleanChat([callTool("flow_note", "n1", { field: "subscribed", value: "да" }), saying("Отлично!")], "eq", true);
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Да, я подписан");

    expect((await runOf(chat.service, id))?.state).toBe("offer");
    expect((await chat.store.readCard(OWNER)).map((entry) => entry.value)).toEqual([true]);
  });

  it("«нет» не выполняет «= да», но выполняет «≠ да»", async () => {
    const stays = booleanChat([callTool("flow_note", "n1", { field: "subscribed", value: "нет" }), saying("Понятно.")], "eq", true);
    const first = await newChat(stays.service);
    await say(stays.service, first.id, "Нет, не подписан");
    expect((await runOf(stays.service, first.id))?.state).toBe("intro");

    const moves = booleanChat([callTool("flow_note", "n1", { field: "subscribed", value: "нет" }), saying("Понятно.")], "ne", true);
    const second = await newChat(moves.service);
    await say(moves.service, second.id, "Нет, не подписан");
    expect((await runOf(moves.service, second.id))?.state).toBe("offer");
  });
});
