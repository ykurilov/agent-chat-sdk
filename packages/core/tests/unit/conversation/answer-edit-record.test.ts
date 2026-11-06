import { describe, expect, it, vi } from "vitest";
import { checkedAnswerEditData, withAnswerEdit, answerEditOf } from "../../../src/conversation/answer-edit-record";
import { createAnswerEdited } from "../../../src/conversation/answer-edited";
import type { AnswerEditedInput } from "../../../src/conversation/answer-edit-record";

describe("answer edit app data", () => {
  it("snapshots JSON and rejects cycles, non-JSON, oversized or excessively nested data", () => {
    const source = { why: "точнее", tags: ["one", null] }; const snapshot = checkedAnswerEditData(source); source.why = "changed";
    expect(snapshot?.why).toBe("точнее");
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    let deep = {}; for (let i = 0; i < 35; i++) deep = { next: deep };
    for (const data of [cycle, { n: Infinity }, { x: undefined }, { x: () => {} }, { date: new Date() }, { why: "я".repeat(9000) }, deep]) expect(() => checkedAnswerEditData(data)).toThrowError(expect.objectContaining({ kind: "invalid_data" }));
  });
  it("edit of an edit has one direct source record", () => {
    const first = { sourceMessageId: "a", ownerId: "u", editedAt: "now", data: { why: "first" } };
    const second = { ...first, sourceMessageId: "b", data: { why: "second" } };
    const parts = withAnswerEdit(withAnswerEdit([{ type: "text", text: "answer" }], first), second);
    expect(parts.filter(p => p.type === "data-answer-edit")).toHaveLength(1);
    expect(answerEditOf(parts)).toEqual(second);
  });
});
const event: AnswerEditedInput = { ownerId: "u", chatId: "c", messageId: "b", sourceMessageId: "a", editedAt: "now", sourceText: "old", text: "new", data: { why: "annotation" } };
it("exhausted app hook is logged, does not reject drain, and attempts receive isolated snapshots", async () => {
  vi.useFakeTimers();
  try {
    const failure = new Error("journal offline");
    const seen: unknown[] = [];
    const handler = vi.fn(async (input: AnswerEditedInput) => { seen.push(input.data?.why); input.data!.why = "mutated"; throw failure; });
    const log = vi.fn(); const delivery = createAnswerEdited(handler, log);
    delivery.notify(event);
    const drained = delivery.drain(); await vi.advanceTimersByTimeAsync(5000); await drained;
    expect(handler).toHaveBeenCalledTimes(3); expect(seen).toEqual(["annotation", "annotation", "annotation"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("onAnswerEdited"), failure);
  } finally { vi.useRealTimers(); }
});
it("a hung app callback expires within the documented deadline", async () => {
  vi.useFakeTimers();
  try {
    const log = vi.fn(); const delivery = createAnswerEdited(() => new Promise(() => {}), log);
    delivery.notify(event); const drained = delivery.drain();
    await vi.advanceTimersByTimeAsync(30001); await drained;
    expect(log).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
