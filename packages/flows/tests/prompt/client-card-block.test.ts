import { describe, expect, it } from "vitest";
import type { FlowRun } from "../../src/engine/flow-run";
import { applyTransition, startRun } from "../../src/engine/run-updates";
import type { AgentFlow } from "../../src/format/flow-format";
import { clientCardBlock } from "../../src/prompt/client-card-block";
import type { ClientCardEntry } from "../../src/store/flow-store";
import { DAY, fixtureFlow } from "../flow-fixtures";

// T082: блок `flow:client` — известное, «давно — уточнить», «можно спросить между делом: X» или «сейчас не спрашивай».

const NOW = Date.UTC(2026, 9, 13, 10);
const flow: AgentFlow = fixtureFlow("sales-review");

const entry = (fieldId: string, value: unknown, at = NOW): ClientCardEntry => ({ fieldId, value, updatedAt: new Date(at).toISOString(), chatId: "c", flowId: "sales-review" });

function runIn(state: string, patch: Partial<FlowRun> = {}): FlowRun {
  const run = startRun(flow, NOW);
  const moved = state === run.state ? run : applyTransition(flow, run, { from: run.state, to: state, exitId: "t", decidedBy: "event", tags: [], at: NOW });
  return { ...moved, ...patch };
}

const everything = [
  entry("name", "Ольга"),
  entry("course_topic", "Акварель"),
  entry("sales", "до 10 продаж"),
  entry("occupation", "Иллюстратор"),
  entry("audience", "Новички"),
  entry("channels", "Инстаграм"),
];

describe("T082 блок flow:client", () => {
  it("известное — списком по порядку полей карточки, с именами из сценария", () => {
    const block = clientCardBlock({ flow, run: runIn("block"), card: [entry("course_topic", "Акварель"), entry("name", "Ольга")], now: NOW });

    expect(block).toContain("Имя: Ольга");
    expect(block).toContain("Тема курса: Акварель");
    expect(block.indexOf("Имя: Ольга")).toBeLessThan(block.indexOf("Тема курса: Акварель"));
    expect(block).not.toContain("Аудитория:");
  });

  it("заметки этого чата идут отдельно и только из этого чата", () => {
    const block = clientCardBlock({ flow, run: runIn("block", { notes: { main_block: "Не доверяют" } }), card: everything, now: NOW });

    expect(block).toMatch(/заметки этого чата/i);
    expect(block).toContain("Главный затык: Не доверяют");
  });

  it("значение не по типу — как неизвестное: не показывается как известное", () => {
    const block = clientCardBlock({ flow, run: runIn("block"), card: [entry("sales", "миллион"), entry("name", "")], now: NOW });

    expect(block).not.toContain("миллион");
    expect(block).not.toContain("Имя:");
  });

  it("устарело — пометка «давно» и просьба мягко сверить, когда подошёл темп", () => {
    const old = [...everything.filter((item) => item.fieldId !== "channels"), entry("channels", "Инстаграм", NOW - 220 * DAY)];
    const block = clientCardBlock({ flow, run: runIn("block", { humanMessages: 5, sideQuestionAt: 0, notes: { main_block: "x" } }), card: old, now: NOW });

    expect(block).toMatch(/Откуда приходят люди: Инстаграм.*давно/);
    expect(block).toMatch(/уточни|сверь/i);
    expect(block).toContain("channels");
  });

  it("устарело, но темп не подошёл — пометка «давно» есть, спрашивать не просит", () => {
    const old = [...everything.filter((item) => item.fieldId !== "channels"), entry("channels", "Инстаграм", NOW - 220 * DAY)];
    const block = clientCardBlock({ flow, run: runIn("block", { humanMessages: 3, sideQuestionAt: 2, notes: { main_block: "x" } }), card: old, now: NOW });

    expect(block).toMatch(/Откуда приходят люди: Инстаграм.*давно/);
    expect(block).toMatch(/сейчас не спрашивай/i);
  });

  it("неизвестное поле, темп подошёл — «можно спросить между делом: X» с пояснением и просьбой отметить вопрос", () => {
    const block = clientCardBlock({
      flow,
      run: runIn("block", { humanMessages: 5, sideQuestionAt: 0, notes: { main_block: "x" } }),
      card: [entry("course_topic", "Акварель"), entry("sales", "до 10 продаж")],
      now: NOW,
    });

    expect(block).toMatch(/можно спросить между делом: «Имя»/i);
    expect(block).toContain("Как обращаться к человеку");
    expect(block).toContain("asked");
  });

  it("«узнать здесь» неизвестно — спросить сразу, вне темпа", () => {
    const block = clientCardBlock({ flow, run: runIn("intro", { humanMessages: 1, sideQuestionAt: 1 }), card: [], now: NOW });

    expect(block).toMatch(/узнай.*«Тема курса»/i);
  });

  it("состояние «без вопросов» и конец сценария — «сейчас не спрашивай»", () => {
    const quiet = clientCardBlock({ flow, run: runIn("doubts", { notes: { doubt: "x" } }), card: [], now: NOW });
    expect(quiet).toMatch(/сейчас не спрашивай/i);
    expect(quiet).not.toMatch(/можно спросить между делом/);

    const done = clientCardBlock({ flow, run: runIn("booked"), card: [], now: NOW });
    expect(done).toMatch(/сейчас не спрашивай/i);
  });

  it("всё известно — спрашивать нечего", () => {
    const block = clientCardBlock({ flow, run: runIn("block", { humanMessages: 9, sideQuestionAt: 0, notes: { main_block: "x" } }), card: everything, now: NOW });

    expect(block).toMatch(/сейчас не спрашивай/i);
  });

  it("сценарий без полей — блока нет", () => {
    const empty = fixtureFlow("sales-review", (json) => {
      json.clientCard = [];
      json.chatNotes = [];
      for (const state of json.states) state.learn = [];
      json.states = json.states.map((state: Record<string, any>) => ({ ...state, exits: (state.exits ?? []).filter((exit: Record<string, any>) => exit.when.type !== "data") }));
    });
    expect(clientCardBlock({ flow: empty, run: startRun(empty, NOW), card: [], now: NOW })).toBe("");
  });

  it("не меняется, пока ничего не менялось: один и тот же вход — один и тот же текст", () => {
    const input = { flow, run: runIn("block", { humanMessages: 5, sideQuestionAt: 0 }), card: everything, now: NOW };
    expect(clientCardBlock(input)).toBe(clientCardBlock({ ...input }));
  });
});

describe("свободные факты в блоке flow:client", () => {
  const fact = (id: string, text: string, at = NOW) => ({ id, text, updatedAt: new Date(at).toISOString(), chatId: "c", flowId: "sales-review" });

  it("факты идут после полей отдельным списком; порядок — как переданы (по времени записи)", () => {
    const block = clientCardBlock({ flow, run: runIn("block"), card: [entry("name", "Ольга")], facts: [fact("f1", "Ведёт блог"), fact("f2", "Живёт в Тбилиси")], now: NOW });

    expect(block).toMatch(/Факты о человеке/);
    expect(block.indexOf("- Имя: Ольга")).toBeLessThan(block.indexOf("- Ведёт блог"));
    expect(block.indexOf("- Ведёт блог")).toBeLessThan(block.indexOf("- Живёт в Тбилиси"));
  });

  it("у сценария без полей, но с фактами блок есть; без фактов и без полей — по-прежнему пусто", () => {
    const empty = fixtureFlow("sales-review", (json) => {
      json.clientCard = [];
      json.chatNotes = [];
      for (const state of json.states) state.learn = [];
      json.states = json.states.map((state: Record<string, any>) => ({ ...state, exits: (state.exits ?? []).filter((exit: Record<string, any>) => exit.when.type !== "data") }));
    });
    expect(clientCardBlock({ flow: empty, run: startRun(empty, NOW), card: [], facts: [fact("f1", "Ведёт блог")], now: NOW })).toContain("- Ведёт блог");
    expect(clientCardBlock({ flow: empty, run: startRun(empty, NOW), card: [], facts: [], now: NOW })).toBe("");
  });

  it("без аргумента facts блок тот же, что в 0.49 (кэш запроса у старых приложений цел)", () => {
    const input = { flow, run: runIn("block"), card: [entry("name", "Ольга")], now: NOW };
    expect(clientCardBlock(input)).toBe(clientCardBlock({ ...input, facts: [] }));
    expect(clientCardBlock(input)).not.toMatch(/факты/i);
  });
});

