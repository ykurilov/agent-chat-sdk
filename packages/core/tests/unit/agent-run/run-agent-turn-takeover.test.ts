import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { UsageRecord } from "../../../src/conversation/types";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { chatId, savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

/** Модель: шаг 1 — вызов `slow` (расход 100 на входе, 30 на выходе), шаг 2 — ответ текстом с тем же расходом. */
function callThenAnswer() {
  const steps: LanguageModelV4StreamPart[][] = [
    [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "slow", input: "{}" }, finishPart("tool-calls")],
    [streamStart, ...textParts(["Готово."]), finishPart()],
  ];
  return new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(steps.shift()!) }) });
}

/** Инструмент, который думает `ms` по часам теста и на «Стоп» не смотрит. */
const slowTool = (ms: number) => ({
  slow: tool({ description: "Долго", inputSchema: z.object({}), execute: () => new Promise<string>((resolve) => setTimeout(() => resolve("ок"), ms)) }),
});

/** Хранилище общее с «другой копией»; записи журнала расхода видны тесту. */
async function recordingStorage() {
  const storage = await storageWithQuestion();
  const written: UsageRecord[] = [];
  const recording: ChatStorage = {
    ...storage,
    insertUsageRecord: async (record) => {
      written.push(record);
      await storage.insertUsageRecord(record);
    },
  };
  return { storage: recording, written };
}

/**
 * Другая копия сервера прерывает ответ «a1», как это делает восстановление: конечная запись «прерван», затем в журнал —
 * расход, записанный в ответ на этот миг.
 */
async function otherCopyInterrupts(storage: ChatStorage, finishMessage: ChatStorage["finishMessage"] = storage.finishMessage) {
  const saved = (await savedAnswer(storage))!;
  await finishMessage("a1", { status: "interrupted" });
  const { pendingSteps: _steps, ...usage } = saved.usage ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  if (usage.inputTokens === 0 && usage.outputTokens === 0) return;
  await storage.insertUsageRecord({
    id: "other-copy",
    ownerId: "anna",
    chatId,
    messageId: "a1",
    source: "answer",
    modelId: saved.modelId!,
    providerId: saved.providerId!,
    cacheWriteTokens: 0,
    ...usage,
    costUsd: 0,
    createdAt: saved.createdAt,
  });
}

/** Другая копия прервала ответ со снимком расхода, а в журнал пишет его позже: копии работают вперемешку. */
async function otherCopyInterruptsJournalLater(storage: ChatStorage, finishMessage: ChatStorage["finishMessage"]) {
  const saved = (await savedAnswer(storage))!;
  const { pendingSteps: _steps, ...usage } = saved.usage!;
  await finishMessage("a1", { status: "interrupted", usage });
  return () =>
    storage.insertUsageRecord({
      id: "other-copy",
      ownerId: "anna",
      chatId,
      messageId: "a1",
      source: "answer",
      modelId: saved.modelId!,
      providerId: saved.providerId!,
      cacheWriteTokens: 0,
      ...usage,
      costUsd: 0,
      createdAt: saved.createdAt,
    });
}

const finalChunks = (chunks: UIMessageChunk[]) => ({
  status: chunks.filter((chunk) => chunk.type === "message-metadata").at(-1)?.messageMetadata,
  last: chunks.at(-1)?.type,
  errors: chunks.filter((chunk) => chunk.type === "error"),
});

const sum = (records: UsageRecord[], field: "inputTokens" | "outputTokens") => records.reduce((total, record) => total + record[field], 0);

describe("runAgentTurn: ответ прервала другая копия сервера (FR-060)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-01T10:00:00.000Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("промежуточная запись узнаёт об этом — ход останавливается сразу, клиент получает «прерван», расход не задваивается", async () => {
    const { storage, written } = await recordingStorage();
    let settled = false;
    const reading = readAll(startTurn(storage, callThenAnswer(), { ownerId: "anna", tools: slowTool(90_000), toolTimeout: { forTool: () => Infinity } })).finally(() => {
      settled = true;
    });
    // Инструмент думает; в ответе по ходу записана оценка расхода шага 1.
    await vi.advanceTimersByTimeAsync(2_000);
    await otherCopyInterrupts(storage);
    const recovered = (await savedAnswer(storage))!;

    await vi.advanceTimersByTimeAsync(10_000);

    expect(settled).toBe(true);
    const { status, last, errors } = finalChunks(await reading);
    expect(status).toMatchObject({ status: "interrupted" });
    expect(last).toBe("finish");
    expect(errors).toEqual([]);
    // Ответ остался таким, каким его закрыла другая копия.
    expect(await savedAnswer(storage)).toEqual(recovered);
    // Расход хода — только шаг 1, и его уже записала другая копия: ход не дописывает его второй раз.
    expect(written.map((record) => record.id)).toEqual(["other-copy"]);
    expect(written[0]).toMatchObject({ inputTokens: recovered.usage!.inputTokens, outputTokens: recovered.usage!.outputTokens });
  });

  it("конечная запись узнаёт об этом — поток кончается «прерван» без ошибки, в журнал идёт только то, чего там ещё нет", async () => {
    const { storage, written } = await recordingStorage();
    const shared = storage.finishMessage;
    const racing: ChatStorage = {
      ...storage,
      finishMessage: async (messageId, final) => {
        // В ответе по ходу записан расход шага 1; другая копия успела прервать ответ раньше и записала его в журнал.
        await storage.updateStreamingMessage(messageId, { parts: (await savedAnswer(storage))!.parts, usage: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 30, reasoningTokens: 10 } });
        await otherCopyInterrupts(storage, shared);
        await shared(messageId, final);
      },
    };

    const chunks = await onFakeClock(() => readAll(startTurn(racing, callThenAnswer(), { ownerId: "anna", tools: slowTool(0) })));
    await vi.advanceTimersByTimeAsync(1_000);

    const { status, last, errors } = finalChunks(chunks);
    expect(status).toMatchObject({ status: "interrupted" });
    expect(last).toBe("finish");
    expect(errors).toEqual([]);
    expect((await savedAnswer(storage))!.status).toBe("interrupted");
    // Два шага по 100/30: шаг 1 записала другая копия, шаг 2 — этот ход.
    expect(written).toHaveLength(2);
    expect(sum(written, "inputTokens")).toBe(200);
    expect(sum(written, "outputTokens")).toBe(60);
  });

  it("другая копия прервала ответ, но ещё не записала расход в журнал — ход пишет только своё сверх её снимка, без задвоения", async () => {
    const { storage, written } = await recordingStorage();
    const shared = storage.finishMessage;
    let journalLater: (() => Promise<void>) | undefined;
    const racing: ChatStorage = {
      ...storage,
      finishMessage: async (messageId, final) => {
        await storage.updateStreamingMessage(messageId, {
          parts: (await savedAnswer(storage))!.parts,
          usage: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 30, reasoningTokens: 10 },
        });
        journalLater = await otherCopyInterruptsJournalLater(storage, shared);
        await shared(messageId, final);
      },
    };

    const chunks = await onFakeClock(() => readAll(startTurn(racing, callThenAnswer(), { ownerId: "anna", tools: slowTool(0) })));
    await journalLater!();

    expect(finalChunks(chunks).status).toMatchObject({ status: "interrupted" });
    expect(written).toHaveLength(2);
    expect(sum(written, "inputTokens")).toBe(200);
    expect(sum(written, "outputTokens")).toBe(60);
  });
});
