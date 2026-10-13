import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { ChatBusyError, createRunningAnswerRegistry } from "../../../src/running-answers/running-answer-registry";
import { readAll } from "../support/mock-model";

/** Источник кусков, которым тест управляет вручную. */
function controlledSource() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  let signal: AbortSignal | undefined;
  const stream = new ReadableStream<UIMessageChunk>({
    start(streamController) {
      controller = streamController;
    },
  });
  return {
    produce: (abortSignal: AbortSignal) => {
      signal = abortSignal;
      return stream;
    },
    push: (delta: string) => controller.enqueue({ type: "text-delta", id: "t", delta }),
    end: () => controller.close(),
    signal: () => signal,
  };
}

const deltas = (chunks: UIMessageChunk[]) => chunks.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : chunk.type));

/** Даёт реестру прочитать всё, что уже лежит в источнике. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("реестр идущих ответов", () => {
  it("подписчик посреди хода получает все прошлые куски, затем новые, без повторов и пропусков", async () => {
    const registry = createRunningAnswerRegistry();
    const source = controlledSource();
    registry.start("chat-1", "answer-1", source.produce);
    source.push("а");
    source.push("б");
    await flush();

    const late = registry.subscribe("chat-1");
    expect(late).not.toBeNull();
    const received = readAll(late!);
    source.push("в");
    source.push("г");
    source.end();

    expect(deltas(await received)).toEqual(["а", "б", "в", "г"]);
  });

  it("второй ход в том же чате — ChatBusyError; в другом чате — можно", () => {
    const registry = createRunningAnswerRegistry();
    registry.start("chat-1", "answer-1", controlledSource().produce);
    expect(() => registry.start("chat-1", "answer-2", controlledSource().produce)).toThrow(ChatBusyError);
    expect(() => registry.start("chat-2", "answer-3", controlledSource().produce)).not.toThrow();
  });

  it("abort(chatId) останавливает контроллер хода", () => {
    const registry = createRunningAnswerRegistry();
    const source = controlledSource();
    registry.start("chat-1", "answer-1", source.produce);
    expect(source.signal()?.aborted).toBe(false);
    expect(registry.abort("chat-1")).toBe(true);
    expect(source.signal()?.aborted).toBe(true);
    expect(registry.abort("chat-без-хода")).toBe(false);
  });

  it("после конца хода запись удаляется, подписка возвращает null", async () => {
    const registry = createRunningAnswerRegistry();
    const source = controlledSource();
    const { finished } = registry.start("chat-1", "answer-1", source.produce);
    expect(registry.isRunning("chat-1")).toBe(true);
    expect(registry.runningMessageId("chat-1")).toBe("answer-1");
    source.push("а");
    source.end();
    await finished;
    expect(registry.isRunning("chat-1")).toBe(false);
    expect(registry.runningMessageId("chat-1")).toBeNull();
    expect(registry.subscribe("chat-1")).toBeNull();
    expect(() => registry.start("chat-1", "answer-2", controlledSource().produce)).not.toThrow();
  });

  it("отписка слушателя не останавливает ход", async () => {
    const registry = createRunningAnswerRegistry();
    const source = controlledSource();
    const { finished } = registry.start("chat-1", "answer-1", source.produce);
    const reader = registry.subscribe("chat-1")!.getReader();
    source.push("а");
    expect(await reader.read()).toMatchObject({ value: { delta: "а" } });
    await reader.cancel();

    source.push("б");
    await flush();
    expect(source.signal()?.aborted).toBe(false);
    expect(registry.isRunning("chat-1")).toBe(true);

    const next = readAll(registry.subscribe("chat-1")!);
    source.end();
    await finished;
    expect(deltas(await next)).toEqual(["а", "б"]);
  });
});
