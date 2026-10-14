import type { AgentToolsModel, AppStateAccess } from "@ykurilov/agent-chat-core";
import type { Tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, noticeService, saying, scriptedModel } from "../../../core/tests/unit/support/notice-chat";
import { mockModelId } from "../../../core/tests/unit/support/mock-model";
import { FLOW_STATE_KEY } from "../../src/engine/flow-run";
import { startRun } from "../../src/engine/run-updates";
import type { AgentFlow } from "../../src/format/flow-format";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { createClientCard } from "../../src/runtime/client-card";
import type { CardToolsTurn, ClientCardStore } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import type { ClientCardEntry } from "../../src/store/flow-store";
import { fixtureFlow, fixtureJson } from "../flow-fixtures";
import { fakeJudge, fakeTimers, newChat, OWNER, runOf, say, toolOutput, userTexts } from "./flow-chat";

// T901–T902: карточка клиента хранится там, где скажет приложение (`clientCard: { read, write, forget }`).
// Таблица модуля при этом не нужна и не трогается. Сбой хранилища приложения — ответ агенту, а не обрыв хода.

const NOW = Date.UTC(2026, 9, 14, 10);

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) }));
afterEach(() => vi.useRealTimers());

/** Хранилище приложения в памяти: свои записи, вызовы считаются. */
function appCard(initial: ClientCardEntry[] = []) {
  const rows = new Map(initial.map((entry) => [entry.fieldId, entry]));
  const adapter = {
    read: vi.fn<ClientCardStore["read"]>(async () => [...rows.values()]),
    write: vi.fn<ClientCardStore["write"]>(async ({ fieldId, value, chatId, flowId, at }) => {
      rows.set(fieldId, { fieldId, value, chatId, flowId, updatedAt: at.toISOString() });
    }),
    forget: vi.fn<ClientCardStore["forget"]>(async (_ownerId, fieldId) => {
      if (fieldId === "all") rows.clear();
      else rows.delete(fieldId);
    }),
  } satisfies ClientCardStore;
  return { adapter, rows };
}

function setup(initial: ClientCardEntry[] = [], staff = false) {
  const flow: AgentFlow = fixtureFlow("sales-review");
  const store = memoryFlowStore();
  const app = appCard(initial);
  const logError = vi.fn<(message: string) => void>();
  const card = createClientCard(store, () => new Date(NOW), app.adapter, logError);
  const values: Record<string, unknown> = { [FLOW_STATE_KEY]: startRun(flow, NOW) };
  const state: AppStateAccess = {
    get: (path) => (path === undefined ? { ...values } : values[path]),
    set: (path, value) => void (values[path] = structuredClone(value)),
    unset: (path) => void delete values[path],
  };
  const tools = (): Record<string, Tool> => {
    const model = { ownerId: OWNER, chatId: "c1", state, ...(staff && { staff: { id: "admin" } }) } as unknown as AgentToolsModel;
    const turn: CardToolsTurn = { model, flow: async () => ({ flowId: "sales-review", versionId: "v1", flow }) };
    return typeof card.tools === "function" ? card.tools(turn) : card.tools;
  };
  const call = async (name: string, input: unknown): Promise<string> =>
    String(await tools()[name]!.execute!(input as never, { toolCallId: "t1", messages: [], context: {} }));
  return { flow, store, app, card, logError, call, values };
}

const entry = (fieldId: string, value: unknown): ClientCardEntry => ({ fieldId, value, updatedAt: "2026-10-01T10:00:00.000Z", chatId: "old", flowId: "sales-review" });

describe("T901 запись через хранилище приложения", () => {
  it("flow_note пишет через adapter.write: человек, поле, значение, чат, сценарий, момент; таблица модуля пуста", async () => {
    const s = setup();
    const answer = await s.call("flow_note", { field: "name", value: " Ольга " });

    expect(answer).toContain("Имя");
    expect(s.app.adapter.write).toHaveBeenCalledTimes(1);
    expect(s.app.adapter.write).toHaveBeenCalledWith({ ownerId: OWNER, fieldId: "name", value: "Ольга", chatId: "c1", flowId: "sales-review", at: new Date(NOW) });
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("значение не по типу в хранилище приложения не уходит", async () => {
    const s = setup();
    expect(await s.call("flow_note", { field: "sales", value: "миллион" })).toMatch(/не записано/i);
    expect(s.app.adapter.write).not.toHaveBeenCalled();
  });

  it("client_card show читает из хранилища приложения", async () => {
    const s = setup([entry("occupation", "Иллюстратор")]);
    const answer = await s.call("client_card", { action: "show" });

    expect(answer).toContain("Чем занимается: Иллюстратор");
    expect(s.app.adapter.read).toHaveBeenCalledWith(OWNER);
  });

  it("read модуля — прямое чтение хранилища приложения", async () => {
    const s = setup([entry("name", "Ольга")]);
    expect(await s.card.read(OWNER)).toEqual([entry("name", "Ольга")]);
  });

  it("блок «что известно о человеке» собирается из хранилища приложения", async () => {
    const s = setup([entry("name", "Ольга")]);
    const run = startRun(s.flow, NOW);
    const block = await s.card.block({ ownerId: OWNER, flow: s.flow, run });

    expect(block).toContain("- Имя: Ольга");
  });
});

describe("T901 «забудь» стирает в хранилище приложения", () => {
  it("одно поле: adapter.forget(owner, fieldId)", async () => {
    const s = setup([entry("occupation", "Иллюстратор"), entry("name", "Ольга")]);
    expect(await s.call("client_card", { action: "forget", field: "occupation" })).toContain("Чем занимается");

    expect(s.app.adapter.forget).toHaveBeenCalledWith(OWNER, "occupation");
    expect([...s.app.rows.keys()]).toEqual(["name"]);
  });

  it("всё: adapter.forget(owner, \"all\"), заметки чата тоже", async () => {
    const s = setup([entry("occupation", "Иллюстратор")]);
    s.values[FLOW_STATE_KEY] = { ...startRun(s.flow, NOW), notes: { doubt: "Нет времени" } };
    await s.call("client_card", { action: "forget", field: "all" });

    expect(s.app.adapter.forget).toHaveBeenCalledWith(OWNER, "all");
    expect(s.app.rows.size).toBe(0);
    expect((s.values[FLOW_STATE_KEY] as { notes: object }).notes).toEqual({});
  });

  it("forget модуля (экран «забудь обо мне» приложения) идёт в то же хранилище", async () => {
    const s = setup([entry("name", "Ольга")]);
    await s.card.forget(OWNER, "all");

    expect(s.app.adapter.forget).toHaveBeenCalledWith(OWNER, "all");
    expect(s.app.rows.size).toBe(0);
  });
});

describe("«забудь всё» стирает и счётчики попутных задач", () => {
  const noteAsk = (store: ReturnType<typeof memoryFlowStore>, ownerId = OWNER) =>
    store.noteSideTask({ ownerId, taskId: "subscribe", chatId: null, status: "asked", at: new Date(NOW).toISOString() });

  it("инструмент client_card forget all (с хранилищем приложения)", async () => {
    const s = setup();
    await noteAsk(s.store);
    await noteAsk(s.store, "other");
    await s.call("client_card", { action: "forget", field: "all" });

    expect(await s.store.readSideTasks(OWNER, "c1")).toEqual([]);
    expect(await s.store.readSideTasks("other", "c1")).toHaveLength(1);
  });

  it("forget модуля (экран «забудь обо мне»)", async () => {
    const s = setup();
    await noteAsk(s.store);
    await s.card.forget(OWNER, "all");

    expect(await s.store.readSideTasks(OWNER, "c1")).toEqual([]);
  });

  it("без хранилища приложения — то же", async () => {
    const store = memoryFlowStore();
    const card = createClientCard(store, () => new Date(NOW));
    await noteAsk(store);
    await card.forget(OWNER, "all");

    expect(await store.readSideTasks(OWNER, "c1")).toEqual([]);
  });

  it("одно поле стирает только поле: попытки остаются", async () => {
    const s = setup([entry("occupation", "врач")]);
    await noteAsk(s.store);
    await s.call("client_card", { action: "forget", field: "occupation" });

    expect(await s.store.readSideTasks(OWNER, "c1")).toHaveLength(1);
  });

  it("хранилище приложения не стёрло — счётчики не трогаем, человеку честный отказ", async () => {
    const s = setup();
    await noteAsk(s.store);
    s.app.adapter.forget.mockRejectedValueOnce(new Error("база недоступна"));
    expect(await s.call("client_card", { action: "forget", field: "all" })).toMatch(/не стёр/i);

    expect(await s.store.readSideTasks(OWNER, "c1")).toHaveLength(1);
  });
});

describe("T901 сбой хранилища приложения", () => {
  it("запись не удалась — агент получает «не записано» и не говорит, что запомнил; ход не падает", async () => {
    const s = setup();
    s.app.adapter.write.mockRejectedValueOnce(new Error("база недоступна"));
    const answer = await s.call("flow_note", { field: "name", value: "Ольга" });

    expect(answer).toMatch(/не записано/i);
    expect(answer).not.toMatch(/^Записано/);
    expect(s.logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });

  it("после сбоя следующая запись проходит", async () => {
    const s = setup();
    s.app.adapter.write.mockRejectedValueOnce(new Error("сбой"));
    await s.call("flow_note", { field: "name", value: "Ольга" });
    expect(await s.call("flow_note", { field: "name", value: "Ольга" })).toMatch(/^Записано/);
    expect(s.app.rows.get("name")?.value).toBe("Ольга");
  });

  it("стереть не удалось — «не стёр», а не «стёр»", async () => {
    const s = setup([entry("name", "Ольга")]);
    s.app.adapter.forget.mockRejectedValueOnce(new Error("база недоступна"));
    const answer = await s.call("client_card", { action: "forget", field: "all" });

    expect(answer).toMatch(/не стёр/i);
    expect(s.app.rows.size).toBe(1);
    expect(s.logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });

  it("прочитать не удалось — агент не выдаёт пустое за «ничего не знаю»", async () => {
    const s = setup();
    s.app.adapter.read.mockRejectedValue(new Error("база недоступна"));
    const answer = await s.call("client_card", { action: "show" });

    expect(answer).toMatch(/не удалось/i);
    expect(answer).not.toContain("пока ничего не записано");
  });

  it("блок при сбое чтения пуст, ход идёт дальше; ошибка в журнале", async () => {
    const s = setup();
    s.app.adapter.read.mockRejectedValue(new Error("база недоступна"));
    const block = await s.card.block({ ownerId: OWNER, flow: s.flow, run: startRun(s.flow, NOW) });

    expect(block).toBe("");
    expect(s.logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });
});

describe("T901 ход сотрудника: карточка только для чтения", () => {
  it("запись и «забудь» в хранилище приложения не уходят, показать — можно", async () => {
    const s = setup([entry("name", "Ольга")], true);

    expect(await s.call("flow_note", { field: "occupation", value: "Иллюстратор" })).toMatch(/не записано/i);
    expect(await s.call("client_card", { action: "forget", field: "all" })).toMatch(/не стёр/i);
    expect(await s.call("client_card", { action: "show" })).toContain("Ольга");
    expect(s.app.adapter.write).not.toHaveBeenCalled();
    expect(s.app.adapter.forget).not.toHaveBeenCalled();
  });
});

describe("T902 без адаптера — таблица модуля, как в 0.48", () => {
  it("запись и чтение идут в хранилище модуля", async () => {
    const flow = fixtureFlow("sales-review");
    const store = memoryFlowStore();
    const card = createClientCard(store, () => new Date(NOW));
    const values: Record<string, unknown> = { [FLOW_STATE_KEY]: startRun(flow, NOW) };
    const state = { get: (path?: string) => (path === undefined ? { ...values } : values[path]), set: () => {}, unset: () => {} } as unknown as AppStateAccess;
    const model = { ownerId: OWNER, chatId: "c1", state } as unknown as AgentToolsModel;
    const tools = typeof card.tools === "function" ? card.tools({ model, flow: async () => ({ flowId: "sales-review", versionId: "v1", flow }) }) : card.tools;
    await tools.flow_note!.execute!({ field: "name", value: "Ольга" } as never, { toolCallId: "t", messages: [], context: {} });

    expect((await store.readCard(OWNER)).map((item) => item.fieldId)).toEqual(["name"]);
    expect((await card.read(OWNER)).map((item) => item.fieldId)).toEqual(["name"]);
  });
});

describe("T902 в живом ходе: createAgentFlow({ clientCard })", () => {
  function chatWith(app: ReturnType<typeof appCard>, scripts: Parameters<typeof scriptedModel>[0] = [], edit?: (json: Record<string, any>) => void) {
    const json = fixtureJson("sales-review");
    edit?.(json);
    const store = memoryFlowStore();
    const model = scriptedModel(scripts);
    const { judge } = fakeJudge();
    const flow = buildAgentFlow(
      {
        loadFlow: async () => ({ flowId: "sales-review", versionId: "v1", flow: json }),
        store,
        judge: { fallback: { modelId: mockModelId, providerId: "mock" } },
        clientCard: app.adapter,
      },
      { judge, timers: fakeTimers() },
    );
    const { service } = noticeService(model, flow.withChat({ agent: { instructions: "Ты помощник." } }));
    flow.attach(service);
    return { model, store, flow, service };
  }

  it("агент записал поле — оно в хранилище приложения, переход по данным сработал", async () => {
    const app = appCard();
    const chat = chatWith(
      app,
      [callTool("flow_note", "n1", { field: "sales", value: "больше 10 продаж" }), saying("Отлично!")],
      (json) =>
        json.states.find((state: { id: string }) => state.id === "intro").exits.unshift({
          id: "intro_big",
          when: { type: "data", field: "sales", op: "eq", value: "больше 10 продаж" },
          to: "offer",
        }),
    );
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Я продал больше десяти");

    expect(app.rows.get("sales")?.value).toBe("больше 10 продаж");
    expect(await chat.store.readCard(OWNER)).toEqual([]);
    expect((await runOf(chat.service, id))?.state).toBe("offer");
  });

  it("значение, уже лежащее в хранилище приложения, видно агенту и работает в условиях по данным", async () => {
    const app = appCard([entry("name", "Ольга"), entry("sales", "больше 10 продаж")]);
    const chat = chatWith(
      app,
      [callTool("flow_note", "n1", { field: "occupation", value: "Иллюстратор" }), saying("Здравствуйте, Ольга!")],
      (json) =>
        json.states.find((state: { id: string }) => state.id === "intro").exits.unshift({
          id: "intro_big",
          when: { type: "data", field: "sales", op: "eq", value: "больше 10 продаж" },
          to: "offer",
        }),
    );
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Я иллюстратор");

    expect(userTexts(chat.model.doStreamCalls[0]!)).toContain("Имя: Ольга");
    expect((await runOf(chat.service, id))?.state).toBe("offer");
  });

  it("«забудь» агентом: стёрто в хранилище приложения; хэндл — тоже", async () => {
    const app = appCard([entry("occupation", "Иллюстратор")]);
    const chat = chatWith(app, [callTool("client_card", "c1", { action: "forget", field: "occupation" }), saying("Забыл.")]);
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Забудь, где я работаю");

    expect(toolOutput(chat.model.doStreamCalls[1]!, "c1")).toContain("Чем занимается");
    expect(app.rows.size).toBe(0);

    app.rows.set("name", entry("name", "Ольга"));
    expect((await chat.flow.readClientCard(OWNER)).map((item) => item.fieldId)).toEqual(["name"]);
    await chat.flow.forgetClientCard(OWNER, "all");
    expect(app.adapter.forget).toHaveBeenLastCalledWith(OWNER, "all");
    expect(app.rows.size).toBe(0);
  });
});
