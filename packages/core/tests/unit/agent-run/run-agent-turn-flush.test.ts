import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import { controlledModel, finishPart, streamStart } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

// Сборка сообщения из кусков здесь медленная: каждое обновление приходит с задержкой в несколько
// микрозадач. Так проверяется, что flush ждёт куски, уже поданные в сборку, а не только готовые.
vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("ai")>();
  return {
    ...original,
    readUIMessageStream: ((options: Parameters<typeof original.readUIMessageStream>[0]) =>
      (async function* () {
        for await (const message of original.readUIMessageStream(options)) {
          for (let i = 0; i < 50; i++) await Promise.resolve();
          yield message;
        }
      })()) as unknown as typeof original.readUIMessageStream,
  };
});

describe("flush идущего хода", () => {
  it("сразу после поданного куска записывает и этот кусок", async () => {
    const storage = await storageWithQuestion();
    const flushers: NonNullable<AgentTurnInput["flushers"]> = new Set();
    const source = controlledModel();
    const reader = startTurn(storage, source.model, { flushers }).getReader();
    await source.opened;
    const delta = (text: string): LanguageModelV4StreamPart => ({ type: "text-delta", id: "txt-0", delta: text });
    source.push(streamStart, { type: "text-start", id: "txt-0" }, delta("а"), delta("б"));
    // Кусок «б» дошёл до подписчика — значит, уже подан в сборку сообщения.
    while (true) {
      const { value } = await reader.read();
      if (value?.type === "text-delta" && value.delta === "б") break;
    }

    await Promise.all([...flushers].map((flushAnswer) => flushAnswer()));
    expect(textOf((await savedAnswer(storage))?.parts ?? [])).toBe("аб");

    source.push({ type: "text-end", id: "txt-0" }, finishPart());
    source.end();
    while (!(await reader.read()).done);
  });
});
