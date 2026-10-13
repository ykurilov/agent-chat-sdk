import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { runTurnAttempt } from "../../../src/agent-run/turn-attempt";
import type { ChatErrorKind } from "../../../src/conversation/types";

const providerFailure = new Error("Provider returned error");

/** Попытка над готовым списком кусков; `"ошибка"` в списке — сырая ошибка провайдера через `onError`. */
async function attempt(script: Array<UIMessageChunk | "ошибка">, options: { contentSeen?: boolean; abortAfter?: number } = {}) {
  const emitted: UIMessageChunk[] = [];
  const controller = new AbortController();
  const outcome = await runTurnAttempt({
    open: (onError) =>
      new ReadableStream<UIMessageChunk>({
        start(stream) {
          script.forEach((item, index) => {
            if (index === options.abortAfter) controller.abort();
            stream.enqueue(item === "ошибка" ? { type: "error", errorText: onError(providerFailure) } : item);
          });
          stream.close();
        },
      }),
    describeError: () => "overloaded",
    classify: (): ChatErrorKind => "overloaded",
    abortSignal: controller.signal,
    contentSeen: options.contentSeen ?? false,
    emit: (chunk) => emitted.push(chunk),
  });
  return { ...outcome, emitted: emitted.map((chunk) => chunk.type) };
}

const start: UIMessageChunk = { type: "start", messageId: "a1" };
const startStep: UIMessageChunk = { type: "start-step" };
const finishStep: UIMessageChunk = { type: "finish-step" };
const finish: UIMessageChunk = { type: "finish" };
const text: UIMessageChunk[] = [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "Ответ" },
  { type: "text-end", id: "t" },
];

describe("runTurnAttempt: одна попытка хода", () => {
  it("обычный ответ — всё по порядку, конец отдельно, итог ok", async () => {
    const { result, emitted, terminal, errors } = await attempt([start, startStep, ...text, finishStep, finish]);
    expect(result).toEqual({ outcome: "ok" });
    expect(emitted).toEqual(["start", "start-step", "text-start", "text-delta", "text-end", "finish-step"]);
    expect(terminal).toEqual([finish]);
    expect(errors).toEqual([]);
  });

  it("ошибка до первого содержательного куска — служебные куски придержаны и выброшены, сырая ошибка в итоге", async () => {
    const { result, emitted, errors } = await attempt([start, startStep, "ошибка", finish]);
    expect(emitted).toEqual([]);
    expect(result).toEqual({ outcome: "failed", kind: "overloaded", error: providerFailure, contentSeen: false });
    expect(errors).toEqual([{ type: "error", errorText: "overloaded" }]);
  });

  it("ошибка после текста — текст уже отдан, contentSeen", async () => {
    const { result, emitted } = await attempt([start, startStep, ...text.slice(0, 2), "ошибка"]);
    expect(emitted).toEqual(["start", "start-step", "text-start", "text-delta"]);
    expect(result).toMatchObject({ outcome: "failed", contentSeen: true });
  });

  it("contentSeen хода переносится в итог попытки, даже если в ней содержательного не было", async () => {
    const { result } = await attempt([start, "ошибка"], { contentSeen: true });
    expect(result).toMatchObject({ outcome: "failed", contentSeen: true });
  });

  it.each<[string, UIMessageChunk]>([
    ["рассуждение", { type: "reasoning-start", id: "r" }],
    ["вызов", { type: "tool-input-start", toolCallId: "c1", toolName: "lookup" }],
    ["data-*", { type: "data-change", data: { kind: "tasks" } } as UIMessageChunk],
  ])("%s — содержательный кусок", async (_name, chunk) => {
    const { result, emitted } = await attempt([start, chunk, "ошибка"]);
    expect(emitted).toEqual(["start", chunk.type]);
    expect(result).toMatchObject({ outcome: "failed", contentSeen: true });
  });

  it("результат подтверждённого инструмента до запроса к модели отдаётся сразу, но содержательным не считается", async () => {
    const output: UIMessageChunk = { type: "tool-output-available", toolCallId: "c1", output: "удалено" };
    const { result, emitted } = await attempt([start, output, "ошибка"]);
    expect(emitted).toEqual(["start", "tool-output-available"]);
    expect(result).toMatchObject({ outcome: "failed", contentSeen: false });
  });

  it("ответ без содержательных кусков — придержанное отдаётся в конце, итог ok", async () => {
    const { result, emitted } = await attempt([start, startStep, finishStep, finish]);
    expect(result).toEqual({ outcome: "ok" });
    expect(emitted).toEqual(["start", "start-step", "finish-step"]);
  });

  it("«Стоп» — итог aborted", async () => {
    const { result } = await attempt([start, startStep, ...text, finishStep, finish], { abortAfter: 3 });
    expect(result).toEqual({ outcome: "aborted" });
  });
});
