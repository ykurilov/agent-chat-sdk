import type { AgentToolsModel, AppStateAccess } from "@ykurilov/agent-chat-core";
import type { Tool } from "ai";
import { describe, expect, it } from "vitest";
import { FLOW_STATE_KEY, type FlowRun } from "../../src/engine/flow-run";
import { startRun } from "../../src/engine/run-updates";
import type { AgentFlow } from "../../src/format/flow-format";
import { createClientCard } from "../../src/runtime/client-card";
import type { CardToolsTurn } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import { DAY, fixtureFlow } from "../flow-fixtures";

// T080–T081: инструменты `flow_note` и `client_card` на памяти-хранилище и поддельном состоянии чата.

const NOW = Date.UTC(2026, 9, 13, 10);
const OWNER = "olga";

function setup(edit?: (json: Record<string, any>) => void, at = NOW) {
  const flow: AgentFlow = fixtureFlow("sales-review", edit);
  const store = memoryFlowStore();
  const clock = { at };
  const card = createClientCard(store, () => new Date(clock.at));
  const values: Record<string, unknown> = { [FLOW_STATE_KEY]: startRun(flow, at) };
  const state: AppStateAccess = {
    get: (path) => (path === undefined ? { ...values } : values[path]),
    set: (path, value) => void (values[path] = structuredClone(value)),
    unset: (path) => void delete values[path],
  };

  /** Инструменты для чата: карточка получает ход и сценарий чата. */
  function tools(chatId = "c1", flowId = "sales-review"): Record<string, Tool> {
    const model = { ownerId: OWNER, chatId, state } as unknown as AgentToolsModel;
    const turn: CardToolsTurn = { model, flow: async () => ({ flowId, versionId: "v1", flow }) };
    return typeof card.tools === "function" ? card.tools(turn) : card.tools;
  }
  const call = async (name: string, input: unknown, chatId?: string, flowId?: string): Promise<string> => {
    const tool = tools(chatId, flowId)[name];
    if (!tool?.execute) throw new Error(`нет инструмента ${name}`);
    return String(await tool.execute(input as never, { toolCallId: "t1", messages: [], context: {} }));
  };
  const run = () => values[FLOW_STATE_KEY] as FlowRun;
  return { flow, store, card, clock, values, state, tools, call, run };
}

describe("T080 flow_note: запись с проверкой типа", () => {
  it("поле карточки: пишет в хранилище с откуда узнали и когда", async () => {
    const s = setup();
    const answer = await s.call("flow_note", { field: "name", value: " Ольга " });

    expect(answer).toContain("Имя");
    expect(await s.store.readCard(OWNER)).toEqual([
      { fieldId: "name", value: "Ольга", updatedAt: new Date(NOW).toISOString(), chatId: "c1", flowId: "sales-review" },
    ]);
  });

  it("заметка чата: пишет в состояние чата, в карточку не попадает", async () => {
    const s = setup();
    await s.call("flow_note", { field: "main_block", value: "Не доверяют" });

    expect(s.run().notes).toEqual({ main_block: "Не доверяют" });
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("выбор: значение приводится к варианту (без учёта регистра), чужое значение — неизвестно, не записано", async () => {
    const s = setup();
    await s.call("flow_note", { field: "sales", value: "  ДО 10 ПРОДАЖ " });
    expect((await s.store.readCard(OWNER)).map((entry) => entry.value)).toEqual(["до 10 продаж"]);

    const refused = await s.call("flow_note", { field: "sales", value: "миллион" });
    expect(refused).toMatch(/не записано/i);
    expect(refused).toContain("ещё не продавал");
    expect((await s.store.readCard(OWNER)).map((entry) => entry.value)).toEqual(["до 10 продаж"]);
  });

  it("число: число или число строкой; текст вместо числа — неизвестно", async () => {
    const s = setup((json) => (json.clientCard.find((field: { id: string }) => field.id === "audience").type = "number"));
    await s.call("flow_note", { field: "audience", value: "120" });
    expect((await s.store.readCard(OWNER)).map((entry) => entry.value)).toEqual([120]);

    expect(await s.call("flow_note", { field: "audience", value: "много" })).toMatch(/не записано/i);
    expect((await s.store.readCard(OWNER)).map((entry) => entry.value)).toEqual([120]);
  });

  it("пустое значение и значение не того вида не записываются", async () => {
    const s = setup();
    expect(await s.call("flow_note", { field: "name", value: "   " })).toMatch(/не записано/i);
    expect(await s.call("flow_note", { field: "name", value: 5 })).toMatch(/не записано/i);
    expect(await s.call("flow_note", { field: "name" })).toMatch(/не записано|укажи/i);
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("поля нет в сценарии — подсказка с полями сценария, ничего не записано", async () => {
    const s = setup();
    const answer = await s.call("flow_note", { field: "shoe_size", value: "42" });

    expect(answer).toContain("name");
    expect(answer).toContain("main_block");
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("поле можно назвать и по имени — «Имя»", async () => {
    const s = setup();
    await s.call("flow_note", { field: "Имя", value: "Ольга" });
    expect((await s.store.readCard(OWNER)).map((entry) => entry.fieldId)).toEqual(["name"]);
  });

  it("новое значение заменяет старое, свежая отметка времени и чат", async () => {
    const s = setup();
    await s.call("flow_note", { field: "occupation", value: "Иллюстратор" }, "c1");
    s.clock.at = NOW + DAY;
    await s.call("flow_note", { field: "occupation", value: "Дизайнер" }, "c2");

    expect(await s.store.readCard(OWNER)).toEqual([
      { fieldId: "occupation", value: "Дизайнер", updatedAt: new Date(NOW + DAY).toISOString(), chatId: "c2", flowId: "sales-review" },
    ]);
  });

  it("asked: отмечает вопрос между делом — темп считается с этого сообщения; значения не пишет", async () => {
    const s = setup();
    s.values[FLOW_STATE_KEY] = { ...startRun(s.flow, NOW), humanMessages: 6 };
    await s.call("flow_note", { asked: "occupation" });

    expect(s.run().sideQuestionAt).toBe(6);
    expect(await s.store.readCard(OWNER)).toEqual([]);
    expect(await s.call("flow_note", { asked: "shoe_size" })).toContain("name");
  });

  it("вне сценария чата — понятный ответ, ничего не пишет", async () => {
    const s = setup();
    const model = { ownerId: OWNER, chatId: "c1", state: s.state } as unknown as AgentToolsModel;
    const tools = typeof s.card.tools === "function" ? s.card.tools({ model, flow: async () => null }) : s.card.tools;
    const answer = String(await tools.flow_note!.execute!({ field: "name", value: "Ольга" } as never, { toolCallId: "t", messages: [], context: {} }));

    expect(answer).toContain("нет сценария");
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });
});

describe("T080 карточка общая для сценариев приложения", () => {
  it("записано в одном сценарии — читается из другого по id поля, ничего не переспрашивается", async () => {
    const s = setup();
    await s.call("flow_note", { field: "name", value: "Ольга" }, "c1", "sales-review");

    const shop = fixtureFlow("shop-support");
    const model = { ownerId: OWNER, chatId: "c2", state: s.state } as unknown as AgentToolsModel;
    const second = (s.card.tools as (turn: CardToolsTurn) => Record<string, Tool>)({ model, flow: async () => ({ flowId: "shop-support", versionId: "v1", flow: shop }) });
    const shown = String(await second.client_card!.execute!({ action: "show" } as never, { toolCallId: "t", messages: [], context: {} }));

    expect(shown).toContain("Ольга");
    const block = await s.card.block({ ownerId: OWNER, flow: s.flow, run: startRun(s.flow, NOW) });
    expect(block).toContain("Имя: Ольга");
    expect(block).not.toMatch(/между делом:\s*«?Имя/);
  });

  it("другой человек карточку не видит", async () => {
    const s = setup();
    await s.call("flow_note", { field: "name", value: "Ольга" });
    expect(await s.card.read("ivan")).toEqual([]);
    expect(await s.card.block({ ownerId: "ivan", flow: s.flow, run: startRun(s.flow, NOW) })).not.toContain("Ольга");
  });
});

describe("T081 client_card: показать и забыть", () => {
  it("show: поля по порядку важности сценария, значения, неизвестное — «пока не знаю», когда записано", async () => {
    const s = setup();
    await s.call("flow_note", { field: "course_topic", value: "Акварель" });
    await s.call("flow_note", { field: "name", value: "Ольга" });
    const shown = await s.call("client_card", { action: "show" });

    expect(shown.indexOf("Имя")).toBeLessThan(shown.indexOf("Тема курса"));
    expect(shown).toContain("Ольга");
    expect(shown).toContain("Акварель");
    expect(shown).toContain("13.10.2026");
    expect(shown).not.toContain("Аудитория");
  });

  it("show: ничего не записано — так и говорит", async () => {
    const s = setup();
    expect(await s.call("client_card", { action: "show" })).toMatch(/ничего/i);
  });

  it("show: поля из других сценариев приложения тоже видны — человек видит всю карточку", async () => {
    const s = setup();
    await s.store.writeCardField({ ownerId: OWNER, fieldId: "shoe_size", value: "42", chatId: "x", flowId: "shop-support", at: new Date(NOW).toISOString() });
    expect(await s.call("client_card", { action: "show" })).toContain("42");
  });

  it("forget поля по id или имени: стирает только его", async () => {
    const s = setup();
    await s.call("flow_note", { field: "occupation", value: "Иллюстратор" });
    await s.call("flow_note", { field: "name", value: "Ольга" });

    expect(await s.call("client_card", { action: "forget", field: "Чем занимается" })).toContain("Чем занимается");
    expect((await s.store.readCard(OWNER)).map((entry) => entry.fieldId)).toEqual(["name"]);
    expect(await s.call("client_card", { action: "forget", field: "name" })).toBeTruthy();
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("forget заметки чата: стирается из состояния чата", async () => {
    const s = setup();
    await s.call("flow_note", { field: "main_block", value: "Не доверяют" });
    await s.call("client_card", { action: "forget", field: "main_block" });
    expect(s.run().notes).toEqual({});
  });

  it("forget «all»: стирает всю карточку человека", async () => {
    const s = setup();
    await s.call("flow_note", { field: "occupation", value: "Иллюстратор" });
    await s.call("flow_note", { field: "name", value: "Ольга" });
    await s.call("client_card", { action: "forget", field: "all" });

    expect(await s.store.readCard(OWNER)).toEqual([]);
    expect(await s.call("client_card", { action: "show" })).toMatch(/ничего/i);
  });

  it("forget без поля или неизвестного поля — просит уточнить, ничего не стирает", async () => {
    const s = setup();
    await s.call("flow_note", { field: "name", value: "Ольга" });

    expect(await s.call("client_card", { action: "forget" })).toMatch(/какое|укажи/i);
    expect(await s.call("client_card", { action: "forget", field: "shoe_size" })).toMatch(/нет|не запис/i);
    expect(await s.store.readCard(OWNER)).toHaveLength(1);
  });

  it("серверные read и forget — для экрана карточки", async () => {
    const s = setup();
    await s.call("flow_note", { field: "name", value: "Ольга" });
    await s.call("flow_note", { field: "occupation", value: "Иллюстратор" });

    expect((await s.card.read(OWNER)).map((entry) => entry.fieldId).sort()).toEqual(["name", "occupation"]);
    await s.card.forget(OWNER, "name");
    expect((await s.card.read(OWNER)).map((entry) => entry.fieldId)).toEqual(["occupation"]);
    await s.card.forget(OWNER, "all");
    expect(await s.card.read(OWNER)).toEqual([]);
  });
});
