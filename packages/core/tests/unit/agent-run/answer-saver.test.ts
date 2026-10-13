import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnswerSaver } from "../../../src/agent-run/answer-saver";
import type { AgentChatMessage } from "../../../src/conversation/types";
import type { ChatStorage } from "../../../src/storage/chat-storage";

type Parts = AgentChatMessage["parts"];

/** Хранилище, которое помнит каждую запись идущего ответа. */
function recordingStorage() {
  const writes: Parts[] = [];
  const storage = {
    updateStreamingMessage: async (_id: string, patch: { parts: Parts }) => {
      writes.push(structuredClone(patch.parts));
    },
    markAnswerAlive: async () => {},
  } as unknown as ChatStorage;
  return { storage, writes };
}

const textOf = (parts: Parts | undefined) => (parts ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("|");

/** Законченный шаг «Сохранено» и начатый «Стёртое»: части [step-start, text, step-start, text]. */
const twoSteps: UIMessageChunk[] = [
  { type: "start", messageId: "a1" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Сохранено" },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "text-start", id: "t2" },
  { type: "text-delta", id: "t2", delta: "Стёртое" },
];

function saverWithTwoSteps() {
  const { storage, writes } = recordingStorage();
  const saver = createAnswerSaver(storage, "a1", () => ({}), () => null, () => {});
  for (const chunk of twoSteps) saver.observe(chunk);
  return { saver, writes };
}

describe("сохранение ответа: стирание шага (rewind)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("после стирания запись идёт сразу, не дожидаясь окна записи: упади сервер — в базе нет стёртого", async () => {
    const { saver, writes } = saverWithTwoSteps();
    await vi.advanceTimersByTimeAsync(500);
    expect(textOf(writes.at(-1))).toBe("Сохранено|Стёртое");

    await vi.advanceTimersByTimeAsync(100);
    const kept = await saver.rewind(2);

    expect(textOf(kept)).toBe("Сохранено");
    expect(textOf(writes.at(-1))).toBe("Сохранено");
    saver.stop();
  });

  it("flush и snapshot во время стирания ждут его: в базу не уходит стёртое, flush не кончается раньше записи без него", async () => {
    for (let ticks = 0; ticks < 30; ticks++) {
      const { saver, writes } = saverWithTwoSteps();
      const rewinding = saver.rewind(2);
      for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
      const snapshot = saver.snapshot();
      await saver.flush();
      expect(textOf(writes.at(-1)), `flush через ${ticks} микрозадач`).toBe("Сохранено");
      expect(textOf(await snapshot), `snapshot через ${ticks} микрозадач`).toBe("Сохранено");
      await rewinding;
      saver.stop();
    }
  });

  it("куски после стирания дописываются к оставшемуся", async () => {
    const { saver } = saverWithTwoSteps();
    await saver.rewind(2);
    for (const chunk of [{ type: "start-step" }, { type: "text-start", id: "t3" }, { type: "text-delta", id: "t3", delta: "Новое" }, { type: "text-end", id: "t3" }] as UIMessageChunk[]) {
      saver.observe(chunk);
    }
    expect(textOf(await saver.snapshot())).toBe("Сохранено|Новое");
    saver.stop();
  });
});

describe("сохранение ответа: сразу после результата инструмента", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const toolStep = (output: UIMessageChunk): UIMessageChunk[] => [
    { type: "start", messageId: "a1" },
    { type: "start-step" },
    { type: "tool-input-available", toolCallId: "c1", toolName: "write", input: {} },
    { type: "data-app-state", data: { set: { "fields.email": "a@x.ru" } } } as UIMessageChunk,
    output,
  ];

  it.each([
    ["результат", { type: "tool-output-available", toolCallId: "c1", output: "записано" }],
    ["ошибка", { type: "tool-output-error", toolCallId: "c1", errorText: "сбой" }],
  ] as Array<[string, UIMessageChunk]>)("%s инструмента — запись сразу, вместе с записью состояния, без окна 500 мс", async (_kind, output) => {
    const { storage, writes } = recordingStorage();
    const saver = createAnswerSaver(storage, "a1", () => ({}), () => null, () => {});
    // Окно записи уже занято недавней записью: до результата инструмента идёт только она.
    saver.observe({ type: "start", messageId: "a1" });
    await vi.advanceTimersByTimeAsync(500);
    const before = writes.length;
    for (const chunk of toolStep(output).slice(1)) saver.observe(chunk);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.length).toBeGreaterThan(before);
    const last = writes.at(-1)!;
    expect(last.some((part) => part.type === "data-app-state")).toBe(true);
    expect(last.find((part) => part.type === "tool-write")).toMatchObject({ toolCallId: "c1" });
    expect((last.find((part) => part.type === "tool-write") as { state: string }).state).toMatch(/^output-/);
    saver.stop();
  });

  it("промежуточные результаты (preliminary) — окном 500 мс: 50 кусков подряд дают не больше двух записей", async () => {
    const { storage, writes } = recordingStorage();
    const saver = createAnswerSaver(storage, "a1", () => ({}), () => null, () => {});
    saver.observe({ type: "start", messageId: "a1" });
    await vi.advanceTimersByTimeAsync(500);
    const before = writes.length;
    saver.observe({ type: "start-step" });
    saver.observe({ type: "tool-input-available", toolCallId: "c1", toolName: "write", input: {} });
    for (let step = 0; step < 50; step++) {
      saver.observe({ type: "tool-output-available", toolCallId: "c1", output: `шаг ${step}`, preliminary: true } as UIMessageChunk);
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(writes.length - before).toBeLessThanOrEqual(2);
    saver.stop();
  });

  it("текст по-прежнему пишется окном 500 мс", async () => {
    const { storage, writes } = recordingStorage();
    const saver = createAnswerSaver(storage, "a1", () => ({}), () => null, () => {});
    saver.observe({ type: "start", messageId: "a1" });
    await vi.advanceTimersByTimeAsync(500);
    const before = writes.length;
    for (const chunk of [{ type: "start-step" }, { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: "Привет" }] as UIMessageChunk[]) saver.observe(chunk);
    await vi.advanceTimersByTimeAsync(100);
    expect(writes.length).toBe(before);
    await vi.advanceTimersByTimeAsync(400);
    expect(textOf(writes.at(-1))).toBe("Привет");
    saver.stop();
  });
});
