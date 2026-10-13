import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { UsageRecord } from "../../../src/conversation/types";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import {
  finishPart,
  mockCatalog,
  mockModel,
  reasoningAndTextParts,
  streamOf,
  streamStart,
  textParts,
} from "../support/mock-model";
import { readAll } from "../support/mock-model";
import { runTurn, savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

const owner = { ownerId: "anna" };

async function turnRecords(storage: ChatStorage) {
  return storage.sumUsage({ ownerId: "anna" });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runAgentTurn: запись расхода", () => {
  it("расход датируется началом хода, а не его концом", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-31T23:59:00.000Z"));
    const model = mockModel(() => {
      vi.setSystemTime(new Date("2099-02-01T00:05:00.000Z"));
      return streamOf(reasoningAndTextParts(["Привет"]));
    });
    const storage = await storageWithQuestion();
    const written: UsageRecord[] = [];
    const spy: ChatStorage = {
      ...storage,
      insertUsageRecord: async (record) => {
        written.push(record);
        await storage.insertUsageRecord(record);
      },
    };
    await readAll(startTurn(spy, model, owner));
    expect(written[0]?.createdAt).toBe("2099-01-31T23:59:00.000Z");
  });

  it("завершённый ответ дописывает запись с токенами хода", async () => {
    const { storage } = await runTurn(mockModel(() => streamOf(reasoningAndTextParts(["Привет"]))), owner);
    expect(await turnRecords(storage)).toEqual([
      {
        modelId: "mock-model",
        providerId: "mock",
        inputTokens: 100,
        cachedInputTokens: 60,
        cacheWriteTokens: 0,
        outputTokens: 30,
        reasoningTokens: 10,
        costUsd: 0,
      },
    ]);
  });

  it("запись хранит доллары по ценам модели на момент хода", async () => {
    const model = mockModel(() => streamOf(reasoningAndTextParts(["Привет"])));
    const price = { inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: 0.1 };
    const { storage } = await runTurn(model, { ...owner, catalog: mockCatalog({ mock: model }, { pricing: price }) });
    // 40 обычного входа × 1 + 60 из кэша × 0,1 + 30 выхода × 2, всё за миллион
    expect((await turnRecords(storage))[0]?.costUsd).toBeCloseTo((40 * 1 + 60 * 0.1 + 30 * 2) / 1_000_000, 12);
  });

  it("ступень цены выбирается по каждому шагу: два шага по 200 тысяч — по обычной цене", async () => {
    const bigStep = { inputTokens: { total: 200_000, noCache: 200_000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1_000, text: 1_000, reasoning: 0 } };
    const steps: LanguageModelV4StreamPart[][] = [
      [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" }, { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: bigStep }],
      [streamStart, ...textParts(["Готово"]), { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: bigStep }],
    ];
    let call = 0;
    const model = mockModel(() => streamOf(steps[call++]!));
    const price = { inputPerMillion: 1, outputPerMillion: 2, tiers: [{ inputTokensAbove: 272_000, inputPerMillion: 2, outputPerMillion: 3 }] };
    const tools = { lookup: tool({ description: "x", inputSchema: z.object({}), execute: async () => "ok" }) };
    const { storage } = await runTurn(model, { ...owner, tools, catalog: mockCatalog({ mock: model }, { pricing: price }) });
    const [record] = await turnRecords(storage);
    expect(record?.inputTokens).toBe(400_000);
    expect(record?.costUsd).toBeCloseTo((2 * (200_000 * 1 + 1_000 * 2)) / 1_000_000, 12);
  });

  it("часы пик — по времени каждого шага: ход начат до пика, второй шаг уже в пик", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Вторник, 00:59 UTC: первый шаг вне пика, второй запрос уходит в 01:00 — пик.
    vi.setSystemTime(new Date("2026-10-06T00:59:30.000Z"));
    const oneMillionOut = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1_000_000, text: 1_000_000, reasoning: 0 } };
    const steps: LanguageModelV4StreamPart[][] = [
      [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" }, { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: oneMillionOut }],
      [streamStart, ...textParts(["Готово"]), { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: oneMillionOut }],
    ];
    let call = 0;
    const model = mockModel(() => streamOf(steps[call++]!));
    const price = { inputPerMillion: 1, outputPerMillion: 1, peakHours: { multiplier: 2, windows: [{ days: [1, 2, 3, 4, 5], from: "01:00", to: "04:00" }] } };
    const tools = {
      lookup: tool({
        description: "x",
        inputSchema: z.object({}),
        execute: async () => {
          vi.setSystemTime(new Date("2026-10-06T01:00:10.000Z"));
          return "ok";
        },
      }),
    };
    const { storage } = await runTurn(model, { ...owner, tools, catalog: mockCatalog({ mock: model }, { pricing: price }) });
    expect((await turnRecords(storage))[0]?.costUsd).toBeCloseTo(1 + 2, 10);
  });

  it("шаг выше порога ступени стоит по цене ступени", async () => {
    const longStep = { inputTokens: { total: 300_000, noCache: 300_000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1_000, text: 1_000, reasoning: 0 } };
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Готово"]), { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: longStep }]));
    const price = { inputPerMillion: 1, outputPerMillion: 2, tiers: [{ inputTokensAbove: 272_000, inputPerMillion: 2, outputPerMillion: 3 }] };
    const { storage } = await runTurn(model, { ...owner, catalog: mockCatalog({ mock: model }, { pricing: price }) });
    expect((await turnRecords(storage))[0]?.costUsd).toBeCloseTo((300_000 * 2 + 1_000 * 3) / 1_000_000, 12);
  });

  it("у модели без цены запись стоит ровно 0, токены при этом записаны", async () => {
    const { storage } = await runTurn(mockModel(() => streamOf(reasoningAndTextParts(["Привет"]))), owner);
    expect((await turnRecords(storage))[0]).toMatchObject({ costUsd: 0, inputTokens: 100 });
  });

  it("запись помнит владельца, чат, сообщение, источник и время начала хода", async () => {
    const storage = await storageWithQuestion();
    const written: UsageRecord[] = [];
    const spy: ChatStorage = {
      ...storage,
      insertUsageRecord: async (record) => {
        written.push(record);
        await storage.insertUsageRecord(record);
      },
    };
    const before = Date.now();
    await readAll(startTurn(spy, mockModel(() => streamOf(reasoningAndTextParts(["Привет"]))), owner));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ ownerId: "anna", chatId: "chat-1", messageId: "a1", source: "answer", modelId: "mock-model", providerId: "mock" });
    expect(written[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    const recordedAt = Date.parse(written[0]!.createdAt);
    expect(recordedAt).toBeGreaterThanOrEqual(before);
    expect(recordedAt).toBeLessThanOrEqual(Date.now());
  });

  it("токены записанного в кэш входа сохраняются, если провайдер их сообщил", async () => {
    const parts: LanguageModelV4StreamPart[] = [
      streamStart,
      ...textParts(["Ок"]),
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 100, noCache: 20, cacheRead: 50, cacheWrite: 30 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
      },
    ];
    const { storage, answer } = await runTurn(mockModel(() => streamOf(parts)), owner);
    expect((await turnRecords(storage))[0]).toMatchObject({ cachedInputTokens: 50, cacheWriteTokens: 30 });
    expect(answer.usage).toMatchObject({ cacheWriteTokens: 30 });
  });

  it("без записи в кэш поля cacheWriteTokens в итоге сообщения нет", async () => {
    const { answer } = await runTurn(mockModel(() => streamOf(reasoningAndTextParts(["Привет"]))), owner);
    expect(answer.usage).not.toHaveProperty("cacheWriteTokens");
  });

  it("ход с инструментами записывает сумму всех шагов одной записью", async () => {
    const calls: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "tool-call", toolCallId: "c1", toolName: "time", input: "{}" },
      finishPart("tool-calls"),
    ];
    const steps = [calls, reasoningAndTextParts(["Готово"])];
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(steps[step++]!) }) });
    const tools = { time: tool({ description: "время", inputSchema: z.object({}), execute: async () => "12:00" }) };
    const { storage } = await runTurn(model, { ...owner, tools });
    const [sum] = await turnRecords(storage);
    expect(sum).toMatchObject({ inputTokens: 200, outputTokens: 60 });
  });

  it("остановленный на втором шаге ответ записывает расход завершённого первого шага", async () => {
    const storage = await storageWithQuestion();
    const controller = new AbortController();
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        step++;
        if (step === 1) {
          return { stream: streamOf([streamStart, { type: "tool-call", toolCallId: "c1", toolName: "time", input: "{}" }, finishPart("tool-calls")]) };
        }
        controller.abort();
        return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start() {} }) };
      },
    });
    const tools = { time: tool({ description: "время", inputSchema: z.object({}), execute: async () => "12:00" }) };
    await readAll(startTurn(storage, model, { ...owner, tools, abortSignal: controller.signal }));
    expect((await savedAnswer(storage))?.status).toBe("stopped");
    expect((await turnRecords(storage))[0]).toMatchObject({ inputTokens: 100, outputTokens: 30 });
  });

  it("ход с ошибкой до первого токена ничего не записывает", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("сбой");
      },
    });
    const { storage } = await runTurn(model, owner);
    expect(await turnRecords(storage)).toEqual([]);
  });

  it("без ownerId ход работает и расход не записывает", async () => {
    const { storage, answer } = await runTurn(mockModel(() => streamOf(reasoningAndTextParts(["Привет"]))));
    expect(answer.status).toBe("complete");
    expect(await storage.sumUsage({})).toEqual([]);
  });

  it("сбой записи расхода не роняет ход и попадает в журнал сервера", async () => {
    const storage = await storageWithQuestion();
    const broken: ChatStorage = {
      ...storage,
      insertUsageRecord: async () => {
        throw new Error("база недоступна");
      },
    };
    const logged: string[] = [];
    const chunks = await readAll(
      startTurn(broken, mockModel(() => streamOf(reasoningAndTextParts(["Привет"]))), { ...owner, logError: (message) => logged.push(message) }),
    );
    expect(chunks.at(-1)?.type).toBe("finish");
    expect((await savedAnswer(storage))?.status).toBe("complete");
    expect(logged.join("\n")).toMatch(/расход.*база недоступна/i);
  });
});
