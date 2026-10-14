import type { AgentToolsModel, AppStateAccess } from "@ykurilov/agent-chat-core";
import type { Tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { FLOW_STATE_KEY } from "../../src/engine/flow-run";
import { startRun } from "../../src/engine/run-updates";
import type { AgentFlow } from "../../src/format/flow-format";
import { createClientCard } from "../../src/runtime/client-card";
import { FACT_PREFIX, MAX_FACT_LENGTH, MAX_FACTS, factId } from "../../src/runtime/client-facts";
import type { CardToolsTurn, ClientCardStore } from "../../src/runtime/flow-types";
import type { ClientCardEntry, ClientFact } from "../../src/store/flow-store";
import { memoryFlowStore } from "../../src/store/memory";
import { fixtureFlow } from "../flow-fixtures";

// Свободные факты о человеке в карточке клиента («ведёт блог»): рядом с полями, одним и тем же инструментом.
// Нет своего хранилища фактов у приложения — они лежат в таблице модуля под служебным префиксом `fact:`.

const NOW = Date.UTC(2026, 9, 14, 10);
const OWNER = "olga";

type AppSetup = { withFacts: boolean } | false;

/** Хранилище приложения в памяти. Своё хранилище фактов — по желанию. */
function appCard(withFacts: boolean) {
  const rows = new Map<string, ClientCardEntry>();
  const facts = new Map<string, ClientFact>();
  const adapter: ClientCardStore = {
    read: vi.fn(async () => [...rows.values()]),
    write: vi.fn(async ({ fieldId, value, chatId, flowId, at }) => void rows.set(fieldId, { fieldId, value, chatId, flowId, updatedAt: at.toISOString() })),
    forget: vi.fn(async (_owner, fieldId) => (fieldId === "all" ? rows.clear() : void rows.delete(fieldId))),
    ...(withFacts && {
      facts: {
        read: vi.fn(async () => [...facts.values()]),
        add: vi.fn(async ({ fact, chatId, flowId, at }) => void facts.set(fact.id, { ...fact, chatId, flowId, updatedAt: at.toISOString() })),
        forget: vi.fn(async (_owner: string, id: string | "all") => (id === "all" ? facts.clear() : void facts.delete(id))),
      },
    }),
  };
  return { adapter, rows, facts };
}

function setup(app: AppSetup = false, staff = false, facts = true) {
  const flow: AgentFlow = fixtureFlow("sales-review");
  const store = memoryFlowStore();
  const appStore = app ? appCard(app.withFacts) : undefined;
  const clock = { at: NOW };
  const card = createClientCard(store, () => new Date(clock.at), appStore?.adapter, undefined, { facts });
  const values: Record<string, unknown> = { [FLOW_STATE_KEY]: startRun(flow, NOW) };
  const state: AppStateAccess = {
    get: (path) => (path === undefined ? { ...values } : values[path]),
    set: (path, value) => void (values[path] = structuredClone(value)),
    unset: (path) => void delete values[path],
  };
  const tools = (chatId = "c1"): Record<string, Tool> => {
    const model = { ownerId: OWNER, chatId, state, ...(staff && { staff: { id: "admin" } }) } as unknown as AgentToolsModel;
    const turn: CardToolsTurn = { model, flow: async () => ({ flowId: "sales-review", versionId: "v1", flow }) };
    return typeof card.tools === "function" ? card.tools(turn) : card.tools;
  };
  const call = async (name: string, input: unknown, chatId?: string): Promise<string> =>
    String(await tools(chatId)[name]!.execute!(input as never, { toolCallId: "t1", messages: [], context: {} }));
  const block = () => card.block({ ownerId: OWNER, flow, run: startRun(flow, NOW) });
  return { flow, store, appStore, card, clock, tools, call, block, values };
}

describe("факты: запись через flow_note { fact }", () => {
  it("записывает факт в таблицу модуля: текст, где узнали, когда; в поля карточки он не попадает", async () => {
    const s = setup();
    const answer = await s.call("flow_note", { fact: "  Ведёт блог про акварель " });

    expect(answer).toContain("Записано");
    expect(answer).toContain("Ведёт блог про акварель");
    const id = factId("Ведёт блог про акварель");
    expect(await s.store.readCard(OWNER)).toEqual([
      { fieldId: `${FACT_PREFIX}${id}`, value: "Ведёт блог про акварель", updatedAt: new Date(NOW).toISOString(), chatId: "c1", flowId: "sales-review" },
    ]);
  });

  it("тот же факт другими словами регистра и пробелов — одна запись, а не две", async () => {
    const s = setup();
    await s.call("flow_note", { fact: "Ведёт блог" });
    const again = await s.call("flow_note", { fact: "  ведёт   БЛОГ " });

    expect(again).toMatch(/уже записано/i);
    expect(await s.store.readCard(OWNER)).toHaveLength(1);
  });

  it("пустой факт и слишком длинный не записываются", async () => {
    const s = setup();
    expect(await s.call("flow_note", { fact: "   " })).toMatch(/не записано/i);
    expect(await s.call("flow_note", { fact: "а".repeat(MAX_FACT_LENGTH + 1) })).toMatch(/не записано.*короче/i);
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("слишком много фактов: новый не записывается, модель просит стереть лишнее", async () => {
    const s = setup();
    for (let index = 0; index < MAX_FACTS; index++) await s.call("flow_note", { fact: `факт ${index}` });
    const refused = await s.call("flow_note", { fact: "ещё один" });

    expect(refused).toMatch(/не записано/i);
    expect(refused).toMatch(/забудь|сотри|сначала/i);
    expect(await s.store.readCard(OWNER)).toHaveLength(MAX_FACTS);
  });

  it("поле и факт в одном вызове — отказ: нужно что-то одно", async () => {
    const s = setup();
    expect(await s.call("flow_note", { field: "name", value: "Ольга", fact: "ведёт блог" })).toMatch(/не записано/i);
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("сотрудник (песочница) фактов не пишет", async () => {
    const s = setup(false, true);
    expect(await s.call("flow_note", { fact: "ведёт блог" })).toMatch(/не записано.*сотрудник/i);
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });
});

describe("факты: показать и забыть через client_card", () => {
  it("show: поля и факты вместе, у факта — id для «забудь»", async () => {
    const s = setup();
    await s.call("flow_note", { field: "name", value: "Ольга" });
    await s.call("flow_note", { fact: "Ведёт блог" });
    const answer = await s.call("client_card", { action: "show" });

    expect(answer).toContain("Имя: Ольга");
    expect(answer).toMatch(/факты/i);
    expect(answer).toContain(`[${factId("Ведёт блог")}] Ведёт блог`);
  });

  it("show: только факты — это не «ничего не записано»", async () => {
    const s = setup();
    await s.call("flow_note", { fact: "Ведёт блог" });

    expect(await s.call("client_card", { action: "show" })).not.toMatch(/пока ничего/i);
  });

  it("forget по id факта стирает только его", async () => {
    const s = setup();
    await s.call("flow_note", { fact: "Ведёт блог" });
    await s.call("flow_note", { fact: "Живёт в Тбилиси" });
    const answer = await s.call("client_card", { action: "forget", field: factId("Ведёт блог") });

    expect(answer).toContain("Ведёт блог");
    expect((await s.store.readCard(OWNER)).map((entry) => entry.value)).toEqual(["Живёт в Тбилиси"]);
  });

  it("forget по тексту факта (как сказал человек) тоже находит его", async () => {
    const s = setup();
    await s.call("flow_note", { fact: "Ведёт блог" });
    await s.call("client_card", { action: "forget", field: "ведёт блог" });

    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("forget неизвестного факта: стирать нечего, подсказка со списком", async () => {
    const s = setup();
    await s.call("flow_note", { fact: "Ведёт блог" });
    const answer = await s.call("client_card", { action: "forget", field: "f00000000" });

    expect(answer).toMatch(/нет/i);
    expect(await s.store.readCard(OWNER)).toHaveLength(1);
  });

  it("«забудь всё» стирает и факты, и поля, и заметки чата", async () => {
    const s = setup();
    await s.call("flow_note", { field: "name", value: "Ольга" });
    await s.call("flow_note", { fact: "Ведёт блог" });
    await s.call("client_card", { action: "forget", field: "all" });

    expect(await s.store.readCard(OWNER)).toEqual([]);
    expect(await s.call("client_card", { action: "show" })).toMatch(/пока ничего/i);
  });
});

describe("факты в запросе и в чтении карточки", () => {
  it("блок flow:client показывает факты строками в порядке записи, а не по id (начало блока для кэша стабильно)", async () => {
    const s = setup();
    await s.call("flow_note", { fact: "Яблоко" });
    s.clock.at += 60_000;
    await s.call("flow_note", { fact: "Арбуз" });
    const block = await s.block();

    expect(block).toMatch(/факты о человеке/i);
    expect(block).toContain("- Яблоко");
    expect(block.indexOf("- Яблоко")).toBeLessThan(block.indexOf("- Арбуз"));
  });

  it("блок без фактов не меняется: слов про факты нет", async () => {
    const s = setup();
    await s.call("flow_note", { field: "name", value: "Ольга" });

    expect(await s.block()).not.toMatch(/факты/i);
  });

  it("read модуля отдаёт поля и факты (факт — запись `fact:<id>`): так человека передают дальше и рисуют на экране", async () => {
    const s = setup();
    await s.call("flow_note", { field: "name", value: "Ольга" });
    await s.call("flow_note", { fact: "Ведёт блог" });
    const entries = await s.card.read(OWNER);

    expect(entries.map((entry) => [entry.fieldId, entry.value])).toEqual([
      ["name", "Ольга"],
      [`${FACT_PREFIX}${factId("Ведёт блог")}`, "Ведёт блог"],
    ]);
  });

  it("forget модуля по `fact:<id>` стирает один факт, по «all» — всё", async () => {
    const s = setup();
    await s.call("flow_note", { fact: "Ведёт блог" });
    await s.call("flow_note", { fact: "Живёт в Тбилиси" });
    await s.card.forget(OWNER, `${FACT_PREFIX}${factId("Ведёт блог")}`);
    expect((await s.card.read(OWNER)).map((entry) => entry.value)).toEqual(["Живёт в Тбилиси"]);

    await s.card.forget(OWNER, "all");
    expect(await s.card.read(OWNER)).toEqual([]);
  });
});

describe("факты при карточке в хранилище приложения", () => {
  it("у приложения нет своего хранилища фактов: поля идут в приложение, факты — в таблицу модуля", async () => {
    const s = setup({ withFacts: false });
    await s.call("flow_note", { field: "name", value: "Ольга" });
    await s.call("flow_note", { fact: "Ведёт блог" });

    expect([...s.appStore!.rows.keys()]).toEqual(["name"]);
    expect((await s.store.readCard(OWNER)).map((entry) => entry.value)).toEqual(["Ведёт блог"]);
    expect(await s.block()).toContain("- Ведёт блог");
  });

  it("«забудь всё» без хранилища фактов у приложения стирает и поля там, и факты в таблице модуля", async () => {
    const s = setup({ withFacts: false });
    await s.call("flow_note", { fact: "Ведёт блог" });
    await s.call("flow_note", { field: "name", value: "Ольга" });
    await s.call("client_card", { action: "forget", field: "all" });

    expect(s.appStore!.adapter.forget).toHaveBeenCalledWith(OWNER, "all");
    expect(await s.store.readCard(OWNER)).toEqual([]);
  });

  it("свое хранилище фактов: add получает id, текст, чат, сценарий и момент; таблица модуля пуста", async () => {
    const s = setup({ withFacts: true });
    await s.call("flow_note", { fact: " Ведёт блог " });

    expect(s.appStore!.adapter.facts!.add).toHaveBeenCalledWith({
      ownerId: OWNER,
      fact: { id: factId("Ведёт блог"), text: "Ведёт блог" },
      chatId: "c1",
      flowId: "sales-review",
      at: new Date(NOW),
    });
    expect(await s.store.readCard(OWNER)).toEqual([]);
    expect(s.appStore!.rows.size).toBe(0);
    expect(await s.block()).toContain("- Ведёт блог");
  });

  it("свое хранилище фактов: show, forget по id и «забудь всё» идут туда", async () => {
    const s = setup({ withFacts: true });
    await s.call("flow_note", { fact: "Ведёт блог" });
    await s.call("flow_note", { fact: "Живёт в Тбилиси" });
    expect(await s.call("client_card", { action: "show" })).toContain("Живёт в Тбилиси");

    await s.call("client_card", { action: "forget", field: factId("Ведёт блог") });
    expect(s.appStore!.adapter.facts!.forget).toHaveBeenCalledWith(OWNER, factId("Ведёт блог"));
    expect([...s.appStore!.facts.values()].map((fact) => fact.text)).toEqual(["Живёт в Тбилиси"]);

    await s.card.forget(OWNER, "all");
    expect(s.appStore!.adapter.facts!.forget).toHaveBeenCalledWith(OWNER, "all");
    expect(s.appStore!.facts.size).toBe(0);
  });

  it("свое хранилище фактов: read модуля отдаёт факты записями `fact:<id>`", async () => {
    const s = setup({ withFacts: true });
    await s.call("flow_note", { fact: "Ведёт блог" });

    expect((await s.card.read(OWNER)).map((entry) => [entry.fieldId, entry.value])).toEqual([[`${FACT_PREFIX}${factId("Ведёт блог")}`, "Ведёт блог"]]);
  });

  it("сбой хранилища фактов приложения: агенту «не записано», ход не падает, блок собирается без фактов", async () => {
    const s = setup({ withFacts: true });
    s.appStore!.adapter.facts!.add = vi.fn(async () => {
      throw new Error("база недоступна");
    });
    expect(await s.call("flow_note", { fact: "Ведёт блог" })).toMatch(/не записано/i);

    s.appStore!.adapter.facts!.read = vi.fn(async () => {
      throw new Error("база недоступна");
    });
    await expect(s.block()).resolves.toEqual("");
  });
});

describe("факты выключены (так по умолчанию)", () => {
  it("схема flow_note без `fact`: тот же инструмент, что в 0.49 (кэш запроса у старых приложений не меняется)", () => {
    const keys = (s: ReturnType<typeof setup>) => Object.keys((s.tools().flow_note!.inputSchema as unknown as { shape: object }).shape);
    expect(keys(setup(false, false, false))).toEqual(["field", "value", "asked"]);
    expect(keys(setup())).toContain("fact");
  });

  it("блок и show фактов не знают, а запись факта отвечает отказом", async () => {
    const s = setup(false, false, false);
    expect(await s.call("flow_note", { fact: "Ведёт блог" })).toMatch(/не записано/i);
    expect(await s.store.readCard(OWNER)).toEqual([]);
    expect(await s.block()).not.toMatch(/факты/i);
  });
});

describe("factId", () => {
  it("один и тот же факт — один id, регистр и пробелы не важны; разные факты — разные id", () => {
    expect(factId("Ведёт блог")).toBe(factId("  ведёт   БЛОГ "));
    expect(factId("Ведёт блог")).not.toBe(factId("Ведёт канал"));
    expect(factId("Ведёт блог")).toMatch(/^f[0-9a-f]{8}$/);
  });
});
