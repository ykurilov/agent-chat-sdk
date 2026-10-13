import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_FORMAT_VERSION } from "../../../src/conversation/types";
import type { StoredMessage } from "../../../src/conversation/types";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import {
  controlledModel,
  finishPart,
  mockModel,
  mockModelId,
  readAll,
  reasoningAndTextParts,
  reasoningParts,
  streamOf,
  streamStart,
  withoutFrozenContext,
} from "../support/mock-model";
import { chatId, savedAnswer, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";
import { ANSWER_ALIVE_EVERY_MS } from "../../../src/agent-run/answer-liveness";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runAgentTurn", () => {
  describe("с поддельными часами", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("пишет длительность рассуждения между reasoning-start и reasoning-end", async () => {
      const storage = await storageWithQuestion();
      const model = mockModel(
        () =>
          new ReadableStream({
            async start(controller) {
              controller.enqueue(streamStart);
              controller.enqueue({ type: "reasoning-start", id: "reasoning-0" });
              controller.enqueue({ type: "reasoning-delta", id: "reasoning-0", delta: "думаю" });
              await wait(1500);
              for (const part of [
                { type: "reasoning-end", id: "reasoning-0" },
                { type: "text-start", id: "txt-0" },
                { type: "text-delta", id: "txt-0", delta: "Привет!" },
                { type: "text-end", id: "txt-0" },
                finishPart(),
              ] as const) {
                controller.enqueue(part);
              }
              controller.close();
            },
          }),
      );
      const chunks = readAll(startTurn(storage, model));
      await vi.advanceTimersByTimeAsync(1500);
      await chunks;
      expect((await savedAnswer(storage))?.reasoningDurationsMs).toEqual({ "0": 1500 });
    });
  });

  it("создаёт ответ со статусом streaming, в конце — complete с итогом хода", async () => {
    const storage = await storageWithQuestion();
    const inserted: StoredMessage[] = [];
    const watched: ChatStorage = {
      ...storage,
      insertMessage: async (message) => {
        inserted.push(structuredClone(message));
        await storage.insertMessage(message);
      },
    };
    const chunks = await readAll(
      startTurn(watched, mockModel(() => streamOf(reasoningAndTextParts(["При", "вет!"])))),
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: "a1",
      chatId,
      parentId: "u1",
      role: "assistant",
      status: "streaming",
      modelId: mockModelId,
      providerId: "mock",
      formatVersion: CURRENT_FORMAT_VERSION,
    });

    const answer = await savedAnswer(storage);
    expect(answer).toMatchObject({
      status: "complete",
      modelId: mockModelId,
      providerId: "mock",
      formatVersion: CURRENT_FORMAT_VERSION,
      usage: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 30, reasoningTokens: 10 },
    });
    expect(withoutFrozenContext(answer?.parts ?? []).filter((part) => part.type !== "step-start")).toMatchObject([
      { type: "reasoning", text: "думаю", state: "done" },
      { type: "text", text: "Привет!", state: "done" },
    ]);
    expect(Object.keys(answer?.reasoningDurationsMs ?? {})).toEqual(["0"]);

    expect(chunks[0]).toMatchObject({
      type: "start",
      messageId: "a1",
      messageMetadata: { modelId: mockModelId, providerId: "mock" },
    });
    expect(chunks.at(-1)?.type).toBe("finish");
    expect(chunks.at(-2)).toMatchObject({
      type: "message-metadata",
      messageMetadata: {
        status: "complete",
        usage: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 30, reasoningTokens: 10 },
      },
    });
  });

  it("медленная запись не тормозит поток и не запускается второй раз параллельно", async () => {
    const storage = await storageWithQuestion();
    const writes: string[] = [];
    let releaseFirstWrite!: () => void;
    let markFirstWriteBegun!: () => void;
    const firstWrite = new Promise<void>((resolve) => (releaseFirstWrite = resolve));
    const firstWriteBegun = new Promise<void>((resolve) => (markFirstWriteBegun = resolve));
    const slow: ChatStorage = {
      ...storage,
      updateStreamingMessage: async (messageId, patch) => {
        writes.push(textOf(patch.parts));
        if (writes.length === 1) {
          markFirstWriteBegun();
          await firstWrite;
        }
        await storage.updateStreamingMessage(messageId, patch);
      },
    };

    const source = controlledModel();
    const stream = startTurn(slow, source.model);
    const received: string[] = [];
    const reading = (async () => {
      for await (const chunk of stream) if (chunk.type === "text-delta") received.push(chunk.delta);
    })();
    await source.opened;
    source.push(streamStart, { type: "text-start", id: "txt-0" }, { type: "text-delta", id: "txt-0", delta: "а" });

    await firstWriteBegun;
    // Пока первая запись висит, подписчик получает куски дальше, а второй записи параллельно нет.
    source.push(...["б", "в", "г", "д"].map((delta): LanguageModelV4StreamPart => ({ type: "text-delta", id: "txt-0", delta })));
    await vi.waitFor(() => expect(received).toEqual(["а", "б", "в", "г", "д"]));
    expect(writes).toHaveLength(1);
    source.push({ type: "text-end", id: "txt-0" }, finishPart());
    source.end();
    releaseFirstWrite();
    await reading;

    const answer = await savedAnswer(storage);
    expect(answer?.status).toBe("complete");
    expect(textOf(answer?.parts ?? [])).toBe("абвгд");
  });

  it("abort посреди текста — stopped, написанная часть сохранена", async () => {
    const storage = await storageWithQuestion();
    const abort = new AbortController();
    const stream = startTurn(
      storage,
      mockModel(
        ({ abortSignal }) =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(streamStart);
              controller.enqueue({ type: "text-start", id: "txt-0" });
              controller.enqueue({ type: "text-delta", id: "txt-0", delta: "Начало ответа" });
              abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
            },
          }),
      ),
      { abortSignal: abort.signal },
    );
    const chunks: UIMessageChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      if (chunk.type === "text-delta") abort.abort();
    }

    const answer = await savedAnswer(storage);
    expect(answer?.status).toBe("stopped");
    expect(answer?.parts.filter((part) => part.type === "text")).toMatchObject([{ text: "Начало ответа" }]);
    expect(chunks.at(-1)).toMatchObject({ type: "abort" });
    expect(chunks.at(-2)).toMatchObject({ type: "message-metadata", messageMetadata: { status: "stopped" } });
  });

  it("ответ из одних рассуждений — complete без текстовых частей", async () => {
    const storage = await storageWithQuestion();
    await readAll(
      startTurn(storage, mockModel(() => streamOf([streamStart, ...reasoningParts("подумал и промолчал"), finishPart()]))),
    );
    const answer = await savedAnswer(storage);
    expect(answer?.status).toBe("complete");
    expect(answer?.parts.some((part) => part.type === "text")).toBe(false);
    expect(answer?.parts.some((part) => part.type === "reasoning")).toBe(true);
  });
});

describe("запись ответа в хранилище по ходу", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const delta = (text: string): LanguageModelV4StreamPart => ({ type: "text-delta", id: "txt-0", delta: text });
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  /** Ход с моделью под управлением теста; `updates` — промежуточные записи с временем и текстом. */
  async function openedTurn(options: Partial<AgentTurnInput> = {}) {
    const storage = await storageWithQuestion();
    const startedAt = Date.now();
    const updates: Array<{ at: number; text: string }> = [];
    const watched: ChatStorage = {
      ...storage,
      updateStreamingMessage: async (messageId, patch) => {
        updates.push({ at: Date.now() - startedAt, text: textOf(patch.parts) });
        await storage.updateStreamingMessage(messageId, patch);
      },
    };
    const source = controlledModel();
    const finished = readAll(startTurn(watched, source.model, options));
    await source.opened;
    source.push(streamStart, { type: "text-start", id: "txt-0" }, delta("а"));
    await tick();
    return { storage, updates, source, finished };
  }

  it("пишет не чаще раза в 0,5 с, отсчёт от начала хода", async () => {
    const { source, updates } = await openedTurn();
    source.push(delta("б"), delta("в"));
    await tick(499);
    expect(updates).toEqual([]);
    await tick(1);
    expect(updates).toEqual([{ at: 500, text: "абв" }]);

    await tick(100);
    source.push(delta("г"));
    await tick(399);
    expect(updates).toHaveLength(1);
    await tick(1);
    expect(updates.at(-1)).toEqual({ at: 1000, text: "абвг" });

    // Без новых кусков записей нет до знака жизни (FR-060).
    await tick(ANSWER_ALIVE_EVERY_MS - 1);
    expect(updates).toHaveLength(2);
  });

  it("после flush посреди хода запись раз в 0,5 с продолжается; метка flush не попадает ни клиенту, ни в базу", async () => {
    const flushers = new Set<() => Promise<void>>();
    const { storage, source, updates, finished } = await openedTurn({ flushers });
    source.push(delta("б"));
    await tick();
    await Promise.all([...flushers].map((flushAnswer) => flushAnswer()));
    expect(updates.map(({ text }) => text)).toEqual(["аб"]);

    source.push(delta("в"));
    await tick(500);
    expect(updates.map(({ text }) => text)).toEqual(["аб", "абв"]);
    source.push(delta("г"));
    await tick(500);
    expect(updates.map(({ text }) => text)).toEqual(["аб", "абв", "абвг"]);

    source.push({ type: "text-end", id: "txt-0" }, finishPart());
    source.end();
    const chunks = await finished;
    expect(JSON.stringify(chunks)).not.toContain("saverFence");
    expect(JSON.stringify(await savedAnswer(storage))).not.toContain("saverFence");
  });

  it.each(["complete", "stopped", "error"] as const)(
    "конец хода (%s) сразу дописывает остаток, не дожидаясь окна записи",
    async (status) => {
      const abort = new AbortController();
      const { storage, source, updates, finished } = await openedTurn({ abortSignal: abort.signal });
      await tick(500);
      expect(updates).toEqual([{ at: 500, text: "а" }]);
      source.push(delta("б"), delta("в"));
      await tick();

      if (status === "complete") source.push({ type: "text-end", id: "txt-0" }, finishPart());
      if (status === "error") source.push({ type: "error", error: new Error("сбой") });
      if (status === "stopped") abort.abort();
      if (status !== "stopped") source.end();
      await finished;

      const answer = await savedAnswer(storage);
      expect(answer?.status).toBe(status);
      expect(textOf(answer?.parts ?? [])).toBe("абв");
      // Остаток ушёл конечной записью, а не таймером окна.
      expect(updates).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
