import { describe, expect, it } from "vitest";
import { partsForContinuation } from "../../../src/conversation/hanging-tool-calls";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { HANGING_TOOL_CALL_REASON, INTERRUPTED_REASON } from "../../../src/tool-approval/approval-parts";

type Part = AgentChatMessage["parts"][number];
const part = (value: Record<string, unknown>): Part => value as never;

const step = part({ type: "step-start" });
const done = (id: string, output: unknown = "создана") =>
  part({ type: "tool-create_task", toolCallId: id, state: "output-available", input: { title: id }, output });

describe("partsForContinuation: выполненные шаги для «Повторить» (FR-023)", () => {
  it("берёт части до последнего вызова с результатом включительно; текст и рассуждения после него отброшены", () => {
    const parts = [
      step,
      part({ type: "text", text: "Создаю", state: "done" }),
      done("c1"),
      step,
      done("c2"),
      step,
      part({ type: "reasoning", text: "третья…", state: "done" }),
      part({ type: "text", text: "И третья", state: "streaming" }),
    ];
    expect(partsForContinuation(parts, { sameModel: true })).toEqual(parts.slice(0, 5));
  });

  it("нет ни одного законченного вызова — null (продолжать нечего, FR-028)", () => {
    expect(partsForContinuation([step, part({ type: "text", text: "Привет", state: "done" })], { sameModel: true })).toBeNull();
    expect(partsForContinuation([], { sameModel: true })).toBeNull();
    expect(
      partsForContinuation([step, part({ type: "tool-a", toolCallId: "c1", state: "input-streaming", input: {} })], { sameModel: true }),
    ).toBeNull();
  });

  it("вызов, оборванный посреди выполнения, закрыт текстом «результат неизвестен» и считается законченным (US2 сц. 5)", () => {
    const parts = [step, done("c1"), step, part({ type: "tool-create_task", toolCallId: "c2", state: "input-available", input: { title: "c2" } })];
    const continued = partsForContinuation(parts, { sameModel: true })!;
    expect(continued).toHaveLength(4);
    expect(continued[3]).toMatchObject({ toolCallId: "c2", state: "output-error", errorText: HANGING_TOOL_CALL_REASON });
  });

  it("промежуточный результат без окончательного закрыт так же, с выводом в тексте ошибки", () => {
    const parts = [step, part({ type: "tool-slow", toolCallId: "c1", state: "output-available", input: {}, output: "half", preliminary: true })];
    expect(partsForContinuation(parts, { sameModel: true })![1]).toMatchObject({
      state: "output-error",
      errorText: `${HANGING_TOOL_CALL_REASON}\nПоследний промежуточный вывод: half`,
    });
  });

  it("вызов, уже закрытый в базе как висящий или отказом «ход прерван», — законченный", () => {
    const hanging = part({ type: "tool-a", toolCallId: "c1", state: "output-error", input: {}, errorText: HANGING_TOOL_CALL_REASON });
    const interrupted = part({
      type: "tool-b",
      toolCallId: "c2",
      state: "output-denied",
      input: {},
      approval: { id: "ap", approved: false, reason: INTERRUPTED_REASON },
    });
    expect(partsForContinuation([step, hanging], { sameModel: true })).toEqual([step, hanging]);
    expect(partsForContinuation([step, interrupted], { sameModel: true })).toEqual([step, interrupted]);
  });

  it("input-streaming внутри диапазона выброшен (FR-004)", () => {
    const streaming = part({ type: "tool-a", toolCallId: "c0", state: "input-streaming", input: {} });
    expect(partsForContinuation([step, streaming, done("c1")], { sameModel: true })).toEqual([step, done("c1")]);
  });

  it("та же модель — рассуждения и метаданные провайдера сохранены", () => {
    const parts = [
      step,
      part({ type: "reasoning", text: "думаю", state: "done", providerMetadata: { mock: { signature: "s" } } }),
      part({ type: "text", text: "т", state: "done", providerMetadata: { mock: { id: "t" } } }),
      part({ ...(done("c1") as object), callProviderMetadata: { mock: { a: 1 } }, resultProviderMetadata: { mock: { b: 2 } } }),
    ];
    expect(partsForContinuation(parts, { sameModel: true })).toEqual(parts);
  });

  it("другая модель или провайдер — рассуждения выброшены, метаданные провайдера вычищены (FR-026)", () => {
    const parts = [
      step,
      part({ type: "reasoning", text: "думаю", state: "done", providerMetadata: { mock: { signature: "s" } } }),
      part({ type: "text", text: "т", state: "done", providerMetadata: { mock: { id: "t" } } }),
      part({ ...(done("c1") as object), callProviderMetadata: { mock: { a: 1 } }, resultProviderMetadata: { mock: { b: 2 } } }),
    ];
    expect(partsForContinuation(parts, { sameModel: false })).toEqual([step, part({ type: "text", text: "т", state: "done" }), done("c1")]);
  });

  it("записи состояния после последнего законченного вызова сохранены, текст после них отброшен", () => {
    const state = (id: string) => part({ type: "data-app-state", data: { set: { [`fields.${id}`]: id } } });
    const parts = [step, done("c1"), state("c1"), step, part({ type: "text", text: "Записал", state: "streaming" })];
    expect(partsForContinuation(parts, { sameModel: true })).toEqual(parts.slice(0, 3));
  });

  it("параллельные вызовы [A, B, запись A, запись B] — обе записи сохранены, в любой модели", () => {
    const state = (id: string) => part({ type: "data-app-state", data: { set: { [`fields.${id}`]: id } } });
    const parts = [step, done("a"), done("b"), state("a"), state("b"), part({ type: "reasoning", text: "дальше…", state: "streaming" })];
    expect(partsForContinuation(parts, { sameModel: true })).toEqual(parts.slice(0, 5));
    expect(partsForContinuation(parts, { sameModel: false })).toEqual(parts.slice(0, 5));
  });

  it("запись висящего вызова сохранена: вызов закрыт как «результат неизвестен», действие могло выполниться", () => {
    const state = part({ type: "data-app-state", data: { set: { "fields.x": 1 } } });
    const parts = [step, part({ type: "tool-a", toolCallId: "c1", state: "input-available", input: {} }), state];
    const continued = partsForContinuation(parts, { sameModel: true })!;
    expect(continued).toHaveLength(3);
    expect(continued[2]).toEqual(state);
  });

  it("исходные части не меняются", () => {
    const parts = [step, done("c1"), part({ type: "tool-a", toolCallId: "c2", state: "input-available", input: {} })];
    const copy = structuredClone(parts);
    partsForContinuation(parts, { sameModel: false });
    expect(parts).toEqual(copy);
  });
});
