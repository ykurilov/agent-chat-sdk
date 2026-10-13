import { describe, expect, it } from "vitest";
import { answerStepsFrame, answerStepsTask, splitAnswerSteps } from "../../../src/compaction/answer-steps";
import type { AgentChatMessage } from "../../../src/conversation/types";

type Part = AgentChatMessage["parts"][number];

const step = (name: string): Part[] => [
  { type: "step-start" },
  { type: "tool-lookup", toolCallId: name, state: "output-available", input: { query: name }, output: `результат ${name}` },
];

describe("splitAnswerSteps: где резать текущий ответ (только между шагами)", () => {
  it("четыре шага — первые два в пересказ, последние два как есть", () => {
    const parts = [...step("s1"), ...step("s2"), ...step("s3"), ...step("s4")];
    expect(splitAnswerSteps(parts)).toEqual({ earlier: [...step("s1"), ...step("s2")], kept: [...step("s3"), ...step("s4")] });
  });

  it("два шага — в пересказ первый, последний как есть", () => {
    const parts = [...step("s1"), ...step("s2")];
    expect(splitAnswerSteps(parts)).toEqual({ earlier: step("s1"), kept: step("s2") });
  });

  it("один шаг или пусто — резать нечего", () => {
    expect(splitAnswerSteps(step("s1"))).toBeNull();
    expect(splitAnswerSteps([])).toBeNull();
  });

  it("часть застывших блоков перед первым шагом шагом не считается и уходит с первыми шагами", () => {
    const frozen = { type: "data-frozen-context", data: { blocks: [], sent: "all", base: null } } as Part;
    expect(splitAnswerSteps([frozen, ...step("s1")])).toBeNull();
    expect(splitAnswerSteps([frozen, ...step("s1"), ...step("s2")])).toEqual({ earlier: [frozen, ...step("s1")], kept: step("s2") });
  });

  it("пустой шаг в конце (начат и оборван) шагом не считается и остаётся с оставленными", () => {
    const parts = [...step("s1"), ...step("s2"), { type: "step-start" } as Part];
    expect(splitAnswerSteps(parts)).toEqual({ earlier: step("s1"), kept: [...step("s2"), { type: "step-start" }] });
  });

  it("вызов не отрывается от результата: граница всегда перед step-start", () => {
    const parts = [...step("s1"), ...step("s2"), ...step("s3")];
    const split = splitAnswerSteps(parts)!;
    expect(split.kept[0]).toEqual({ type: "step-start" });
    expect([...split.earlier, ...split.kept]).toEqual(parts);
  });
});

describe("тексты пересказа шагов: постоянные (кэш)", () => {
  it("задание зависит только от потолка и просит не вызывать инструменты", () => {
    expect(answerStepsTask(2000)).toBe(answerStepsTask(2000));
    expect(answerStepsTask(2000)).toContain("2 000");
    expect(answerStepsTask(2000)).toContain("Не вызывай инструменты");
  });

  it("обрамление объясняет, что первые шаги убраны, и несёт пересказ", () => {
    const framed = answerStepsFrame("вызвал поиск, нашёл 3 задачи");
    expect(framed.startsWith("<answer_progress>")).toBe(true);
    expect(framed).toContain("вызвал поиск, нашёл 3 задачи");
    expect(framed.endsWith("</answer_progress>")).toBe(true);
  });
});
