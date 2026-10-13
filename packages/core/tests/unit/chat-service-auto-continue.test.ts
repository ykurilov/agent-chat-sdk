import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { StoredMessage } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { conversation } from "./support/compaction-fixtures";
import { onFakeClock } from "./support/fake-clock";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

type Part = StoredMessage["parts"][number];

/** Временный сбой; `retry-after-ms: 1` — тихие повторы без ожидания. Пауза автопродолжения не короче расписания: такие тесты — на подменённых часах. */
const busy = (headers: Record<string, string> = { "retry-after-ms": "1" }) =>
  new APICallError({ message: "503", url: "https://p.test", requestBodyValues: {}, statusCode: 503, responseBody: "Provider returned error", responseHeaders: headers });

const overflowError = () =>
  new APICallError({
    message: "ответ 400",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: '{"error":{"message":"This model\'s maximum context length is 1000 tokens. However, your messages resulted in 5000 tokens."}}',
  });

const brokenText = (text: string, error: unknown = busy()): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "error", error },
];
const sayDone = (text = "Готово"): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/** Модель по сценарию: потоки хода по очереди (`Error` — запрос падает), сводки сжатия по очереди. */
function scripted(streams: Array<LanguageModelV4StreamPart[] | Error>, summaries: string[] = ["## Цель\nсводка"]) {
  const streamQueue = [...streams];
  const summaryQueue = [...summaries];
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = streamQueue.shift();
      if (!next) throw new Error("лишний запрос");
      if (next instanceof Error) throw next;
      return { stream: streamOf(next) };
    },
    doGenerate: async () => {
      const next = summaryQueue.shift();
      if (next === undefined) throw new Error("лишнее сжатие");
      return generateResult(next, { output: 20 });
    },
  });
}

function setup(model: MockLanguageModelV4, backup: MockLanguageModelV4 = scripted([])) {
  const storage: ChatStorage = createInMemoryChatStorage();
  const logged: string[] = [];
  const execute = vi.fn(async ({ title }: { title: string }) => `создана ${title}`);
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model, "mock-backup": backup }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: {
      instructions: "Ты помощник.",
      tools: { create_task: tool({ description: "Создать задачу.", inputSchema: z.object({ title: z.string() }), execute }) },
    },
    // Порог высокий: обычное сжатие после ответа не включается, работает только путь переполнения.
    compaction: { thresholdTokens: 900, tailTokens: 100, summaryCeilingTokens: 100 },
    env: mockEnv,
    logError: (line: string) => logged.push(line),
  });
  return { storage, service, logged, execute };
}

async function chatWith(storage: ChatStorage, messages: StoredMessage[]) {
  await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  for (const message of messages) await storage.insertMessage(message);
}

async function lastAnswer(service: ReturnType<typeof setup>["service"]) {
  return (await service.getHistory("anna", "chat-1")).messages.at(-1)!;
}

const textOf = (parts: readonly Part[]) => parts.map((part) => (part.type === "text" ? part.text : "")).join("");
const autoContinueLines = (logged: string[]) => logged.filter((line) => line.startsWith("[автопродолжение]"));
const question = (text: string) => ({ id: "q", role: "user" as const, parts: [{ type: "text" as const, text }] });

describe("служба чата: автопродолжение после обрыва посреди ответа (US7)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("сц. 6: подписка во время паузы и продолжения получает весь ответ с начала", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const model = scripted([brokenText("Начало ", busy({})), sayDone("и конец.")]);
    const { storage, service } = setup(model);
    await chatWith(storage, []);

    const original = readAll(await service.sendMessage("anna", "chat-1", question("Расскажи")));
    // Обрыв случился, идёт пауза 2 с: продолжения ещё не было.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(model.doStreamCalls).toHaveLength(1);
    const resubscribed = readAll((await service.subscribe("anna", "chat-1"))!);
    await vi.advanceTimersByTimeAsync(1_500);
    const [first, replayed] = await Promise.all([original, resubscribed]);

    expect(model.doStreamCalls).toHaveLength(2);
    for (const chunks of [first, replayed]) {
      expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
      expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
      expect(chunks.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : "")).join("")).toBe("Начало и конец.");
    }
    const answer = await lastAnswer(service);
    expect(answer.metadata?.status).toBe("complete");
    expect(textOf(answer.parts)).toBe("Начало и конец.");
  });

  it("автопродолжение в продолжении после «Повторить» — два на ход, третий обрыв — error", async () => {
    const step: Part = { type: "step-start" };
    const created = { type: "tool-create_task", toolCallId: "c1", state: "output-available", input: { title: "Первая" }, output: "создана Первая" } as Part;
    const model = scripted([brokenText("А"), brokenText("Б"), brokenText("В")]);
    const { storage, service, logged, execute } = setup(model);
    await chatWith(storage, [
      newStoredMessage({ id: "u1", chatId: "chat-1", role: "user", parts: [{ type: "text", text: "Создай задачи" }], createdAt: "2026-01-01T00:00:00.000Z" }),
      newStoredMessage({
        id: "a1",
        chatId: "chat-1",
        parentId: "u1",
        role: "assistant",
        parts: [step, created],
        status: "error",
        modelId: mockModelId,
        providerId: "mock",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    ]);

    await onFakeClock(async () => readAll(await service.retry("anna", "chat-1")));

    const answer = await lastAnswer(service);
    expect(answer.id).not.toBe("a1");
    expect(model.doStreamCalls).toHaveLength(3);
    expect(execute).not.toHaveBeenCalled();
    expect(answer.metadata).toMatchObject({ status: "error", error: { kind: "overloaded" } });
    expect(textOf(answer.parts)).toBe("АБВ");
    expect(autoContinueLines(logged)).toHaveLength(2);
  });

  it("автопродолжение и сжатие при переполнении — общий счёт: обрыв, переполнение, обрыв, обрыв — error после двух продолжений", async () => {
    const model = scripted([brokenText("А"), overflowError(), brokenText("Б"), brokenText("В")]);
    const { storage, service, logged } = setup(model);
    await chatWith(storage, conversation([100, 300, 600]));

    await onFakeClock(async () => readAll(await service.sendMessage("anna", "chat-1", question("новый вопрос"))));

    const answer = await lastAnswer(service);
    expect(model.doStreamCalls).toHaveLength(4);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(answer.metadata).toMatchObject({ status: "error", error: { kind: "overloaded" } });
    expect(textOf(answer.parts)).toBe("АБВ");
    expect(autoContinueLines(logged).map((line) => line.match(/попытка=\d из 2/)![0])).toEqual(["попытка=1 из 2", "попытка=2 из 2"]);
    // Запрос после сжатия — по сжатой истории, с написанным текстом и пометкой последней.
    const afterCompaction = JSON.stringify(model.doStreamCalls[2]!.prompt);
    expect(afterCompaction).toContain("<conversation_summary>");
    expect(afterCompaction).toContain('"text":"А"');
  });

  it("обрыв сразу после копии «Повторить», до кусков модели, — не после содержательного куска: работает запасной, автопродолжения нет", async () => {
    const step: Part = { type: "step-start" };
    const created = { type: "tool-create_task", toolCallId: "c1", state: "output-available", input: { title: "Первая" }, output: "создана Первая" } as Part;
    const primary = scripted([busy(), busy(), busy(), busy()]);
    const backup = scripted([sayDone("Ответ запасного")]);
    const { storage, service, logged } = setup(primary, backup);
    await chatWith(storage, [
      newStoredMessage({ id: "u1", chatId: "chat-1", role: "user", parts: [{ type: "text", text: "Создай задачи" }], createdAt: "2026-01-01T00:00:00.000Z" }),
      newStoredMessage({
        id: "a1",
        chatId: "chat-1",
        parentId: "u1",
        role: "assistant",
        parts: [step, created],
        status: "error",
        modelId: mockModelId,
        providerId: "mock",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    ]);

    await readAll(await service.retry("anna", "chat-1"));

    const answer = await lastAnswer(service);
    expect(answer.metadata).toMatchObject({ status: "complete", providerId: "mock-backup" });
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(autoContinueLines(logged)).toEqual([]);
  });
});
