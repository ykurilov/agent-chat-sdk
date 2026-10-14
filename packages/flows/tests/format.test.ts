import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_FLOW_FORMAT,
  AGENT_FLOW_FORMAT_VERSION,
  compactFlow,
  flowJsonSchema,
  parseFlow,
  type AgentFlow,
  type ParseFlowResult,
} from "../src/format";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Record<string, any>;
const examples = ["sales-review", "shop-support", "sheets-lesson"] as const;

function parsed(input: unknown): AgentFlow {
  const result = parseFlow(input);
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  return result.flow;
}

function errorsOf(result: ParseFlowResult) {
  if (result.ok) throw new Error("сценарий разобрался, а не должен был");
  return result.errors;
}

const minimal = () => ({ format: "agent-flow", version: 1, id: "one", name: "Один", states: [{ id: "s1", title: "Начало" }] });

describe("формат сценария: примеры прототипа", () => {
  it.each(examples)("%s разбирается", (name) => {
    const flow = parsed(fixture(name));
    expect(flow.format).toBe(AGENT_FLOW_FORMAT);
    expect(flow.version).toBe(AGENT_FLOW_FORMAT_VERSION);
    expect(flow.states.length).toBeGreaterThan(0);
  });

  it.each(examples)("%s: после сжатия получается исходный JSON (уже в текущей версии)", (name) => {
    expect(compactFlow(parsed(fixture(name)))).toEqual({ ...fixture(name), version: AGENT_FLOW_FORMAT_VERSION });
  });

  it("принимает строку JSON", () => {
    expect(parsed(JSON.stringify(fixture("shop-support"))).id).toBe("shop-support");
  });
});

describe("формат сценария: значения по умолчанию", () => {
  it("дополняет сценарий без необязательных полей", () => {
    const flow = parsed(minimal());
    expect(flow).toMatchObject({
      start: null,
      common: "",
      pace: { sideQuestionEveryMessages: 5 },
      clientCard: [],
      chatNotes: [],
      tools: [],
      anyState: { except: [], exits: [] },
      layout: {},
    });
    expect(flow.states[0]).toEqual({
      id: "s1",
      kind: "state",
      title: "Начало",
      instructions: "",
      firstMessage: null,
      learn: [],
      noSideQuestions: false,
      tools: [],
      tags: [],
      exits: [],
    });
  });

  it("поле без типа — текст, условие по данным без операции — «заполнено», условие без цели — null", () => {
    const flow = parsed({
      ...minimal(),
      chatNotes: [{ id: "rating", name: "Оценка" }],
      states: [{ id: "s1", title: "Начало", exits: [{ id: "x1", when: { type: "data", field: "rating" } }] }],
    });
    expect(flow.chatNotes[0]).toEqual({ id: "rating", name: "Оценка", about: "", type: "text", options: [] });
    expect(flow.states[0]!.exits[0]).toEqual({ id: "x1", when: { type: "data", field: "rating", op: "filled" }, to: null });
  });

  it("пустой текст условия и отсутствие старта — не ошибка формата (их ловит проверка графа)", () => {
    const flow = parsed({
      ...minimal(),
      states: [{ id: "s1", title: "", exits: [{ id: "x1", when: { type: "judge", text: "" }, to: "s1" }] }],
    });
    expect(flow.start).toBeNull();
    expect(flow.states[0]!.exits[0]!.when).toEqual({ type: "judge", text: "" });
  });
});

describe("формат сценария: ошибки", () => {
  it("«иначе» отклоняется с понятной причиной", () => {
    const errors = errorsOf(
      parseFlow({ ...minimal(), states: [{ id: "s1", title: "Начало", otherwise: "s1" }] }),
    );
    expect(errors).toEqual([expect.objectContaining({ path: "states[0].otherwise" })]);
    expect(errors[0]!.message).toMatch(/«иначе» больше нет/);
    expect(errors[0]!.message).toMatch(/common/);
  });

  it("без `format` — это не сценарий", () => {
    const { format: _format, ...rest } = minimal();
    const errors = errorsOf(parseFlow(rest));
    expect(errors).toEqual([{ path: "format", message: expect.stringMatching(/не сценарий agent-flow/) }]);
  });

  it("чужой `format` — тоже не сценарий", () => {
    expect(errorsOf(parseFlow({ ...minimal(), format: "bpmn" }))[0]!.message).toMatch(/не сценарий agent-flow/);
  });

  it("версия новее известной — просит обновить SDK", () => {
    const errors = errorsOf(parseFlow({ ...minimal(), version: AGENT_FLOW_FORMAT_VERSION + 1 }));
    expect(errors).toEqual([{ path: "version", message: expect.stringMatching(/обновите SDK/) }]);
  });

  it("сломанный JSON", () => {
    expect(errorsOf(parseFlow("{ \"format\": "))[0]!.message).toMatch(/не JSON/);
  });

  it("неизвестное поле, неизвестный вид условия, таймер без срока, сравнение без значения", () => {
    const errors = errorsOf(
      parseFlow({
        ...minimal(),
        colour: "red",
        states: [
          {
            id: "s1",
            title: "Начало",
            exits: [
              { id: "x1", when: { type: "otherwise" }, to: "s1" },
              { id: "x2", when: { type: "timer", from: "silence", unit: "h" }, to: "s1" },
              { id: "x3", when: { type: "data", field: "tries", op: "gt" }, to: "s1" },
            ],
          },
        ],
      }),
    );
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("colour");
    expect(paths).toContain("states[0].exits[0].when.type");
    expect(paths).toContain("states[0].exits[1].when.amount");
    expect(paths).toContain("states[0].exits[2].when.value");
    for (const error of errors) expect(error.message).toMatch(/[а-яё]/i);
  });

  it("время суток — только «ЧЧ:ММ»", () => {
    const flow = { ...minimal(), states: [{ id: "s1", title: "", exits: [{ id: "x1", when: { type: "timer", from: "time_of_day", at: "25:00" } }] }] };
    expect(errorsOf(parseFlow(flow))[0]!.path).toBe("states[0].exits[0].when.at");
  });
});

describe("JSON Schema", () => {
  it("файл в пакете совпадает со схемой из кода (пересобрать: pnpm --filter @ykurilov/agent-chat-flows schema:write)", () => {
    const file = JSON.parse(readFileSync(new URL("../agent-flow.schema.json", import.meta.url), "utf8"));
    expect(file).toEqual(flowJsonSchema());
  });

  it("описывает обязательные поля сценария", () => {
    const schema = flowJsonSchema() as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(expect.arrayContaining(["format", "version", "id", "name", "states"]));
    expect(schema.properties).not.toHaveProperty("otherwise");
  });
});
