import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_STALE_AFTER_MS } from "../../../src/agent-run/answer-liveness";
import type { UsageRecord } from "../../../src/conversation/types";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, mockModel, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

/** Хранилище, у которого конечная запись ответа падает `failures` раз (база на миг недоступна). */
async function flakyStorage(failures: number) {
  const storage = await storageWithQuestion();
  const usage: UsageRecord[] = [];
  let left = failures;
  let finishCalls = 0;
  const flaky: ChatStorage = {
    ...storage,
    finishMessage: async (messageId, final) => {
      finishCalls += 1;
      if (left-- > 0) throw new Error("connection terminated");
      await storage.finishMessage(messageId, final);
    },
    insertUsageRecord: async (record) => {
      usage.push(record);
      await storage.insertUsageRecord(record);
    },
  };
  return { storage, flaky, usage, finishCalls: () => finishCalls };
}

const answering = () => mockModel(() => streamOf([streamStart, ...textParts(["Ответ готов."]), finishPart()]));

describe("runAgentTurn: сбой базы при конечной записи ответа (FR-061)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-01T10:00:00.000Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("база вернулась со второй попытки — ответ законченный, расход записан один раз", async () => {
    const { storage, flaky, usage, finishCalls } = await flakyStorage(1);

    await onFakeClock(() => readAll(startTurn(flaky, answering(), { ownerId: "anna", logError: () => {} })));

    expect(finishCalls()).toBe(2);
    expect((await savedAnswer(storage))!.status).toBe("complete");
    expect(usage).toHaveLength(1);
  });

  it("база записала конец, но ответ базы потерялся — повтор узнаёт свой итог: ответ законченный, хук и расход как обычно", async () => {
    const storage = await storageWithQuestion();
    const usage: UsageRecord[] = [];
    let finishCalls = 0;
    const lostReply: ChatStorage = {
      ...storage,
      finishMessage: async (messageId, final) => {
        finishCalls += 1;
        await storage.finishMessage(messageId, final);
        // Запись прошла, а ответ базы оборвался.
        if (finishCalls === 1) throw new Error("connection terminated");
      },
      insertUsageRecord: async (record) => {
        usage.push(record);
        await storage.insertUsageRecord(record);
      },
    };
    const finished: string[] = [];

    const chunks = await onFakeClock(() =>
      readAll(startTurn(lostReply, answering(), { ownerId: "anna", logError: () => {}, onFinished: ({ status }) => void finished.push(status) })),
    );

    expect(finishCalls).toBe(2);
    expect(chunks.filter((chunk) => chunk.type === "message-metadata").at(-1)?.messageMetadata).toMatchObject({ status: "complete" });
    expect(chunks.at(-1)?.type).toBe("finish");
    expect((await savedAnswer(storage))!.status).toBe("complete");
    expect(finished).toEqual(["complete"]);
    expect(usage).toHaveLength(1);
  });

  it("запись прошла, ответ базы потерялся, и первая проверка «это моя запись?» тоже упала — проверка повторяется: ответ законченный, расход записан один раз", async () => {
    const storage = await storageWithQuestion();
    const usage: UsageRecord[] = [];
    let finishCalls = 0;
    let failedReads = 0;
    const shaky: ChatStorage = {
      ...storage,
      finishMessage: async (messageId, final) => {
        finishCalls += 1;
        await storage.finishMessage(messageId, final);
        if (finishCalls === 1) throw new Error("connection terminated");
      },
      // Сразу после оборванной записи база ещё не отвечает и на чтение.
      getMessage: async (messageId) => {
        if (finishCalls > 0 && failedReads++ === 0) throw new Error("connection terminated");
        return storage.getMessage(messageId);
      },
      insertUsageRecord: async (record) => {
        usage.push(record);
        await storage.insertUsageRecord(record);
      },
    };

    const chunks = await onFakeClock(() => readAll(startTurn(shaky, answering(), { ownerId: "anna", logError: () => {} })));

    expect(failedReads).toBeGreaterThan(1);
    expect(chunks.filter((chunk) => chunk.type === "message-metadata").at(-1)?.messageMetadata).toMatchObject({ status: "complete" });
    expect((await savedAnswer(storage))!.status).toBe("complete");
    expect(usage).toHaveLength(1);
  });

  it("первая запись прошла, а все попытки вернули обычную ошибку — после повторов ход узнаёт свой итог и пишет расход", async () => {
    const storage = await storageWithQuestion();
    const usage: UsageRecord[] = [];
    let finishCalls = 0;
    const lostReplies: ChatStorage = {
      ...storage,
      finishMessage: async (messageId, final) => {
        finishCalls += 1;
        if (finishCalls === 1) await storage.finishMessage(messageId, final);
        throw new Error("connection terminated");
      },
      insertUsageRecord: async (record) => {
        usage.push(record);
        await storage.insertUsageRecord(record);
      },
    };

    const chunks = await onFakeClock(() => readAll(startTurn(lostReplies, answering(), { ownerId: "anna", logError: () => {} })));

    expect(finishCalls).toBe(3);
    expect(chunks.filter((chunk) => chunk.type === "message-metadata").at(-1)?.messageMetadata).toMatchObject({ status: "complete" });
    expect((await savedAnswer(storage))!.status).toBe("complete");
    expect(usage).toHaveLength(1);
  });

  it("база так и не вернулась — ответ остаётся идущим с расходом, перестаёт быть живым и ждёт восстановления", async () => {
    const { storage, flaky, usage, finishCalls } = await flakyStorage(Infinity);
    const logged: string[] = [];

    await onFakeClock(() => readAll(startTurn(flaky, answering(), { ownerId: "anna", logError: (line) => logged.push(line) })).catch(() => {}));
    await vi.advanceTimersByTimeAsync(ANSWER_STALE_AFTER_MS + 1_000);

    expect(finishCalls()).toBeGreaterThanOrEqual(3);
    const answer = (await savedAnswer(storage))!;
    expect(answer.status).toBe("streaming");
    expect(answer.usage?.outputTokens).toBeGreaterThan(0);
    expect(usage).toEqual([]);
    expect(await storage.listSilentAnswerIds!({ silentForMs: ANSWER_STALE_AFTER_MS })).toEqual(["a1"]);
    expect(logged.join("\n")).toContain("connection terminated");
  });
});
