import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { StoredMessage } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { conversation, timeAt } from "./support/compaction-fixtures";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

type Part = StoredMessage["parts"][number];

const overflowError = () =>
  new APICallError({
    message: "ответ 400",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: '{"error":{"message":"This model\'s maximum context length is 1000 tokens. However, your messages resulted in 5000 tokens."}}',
  });

const rateLimitError = () =>
  new APICallError({
    message: "ответ 429",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: "Too many tokens, please wait before trying again.",
    responseHeaders: { "retry-after-ms": "1" },
  });

const sayDone = (text = "Готово"): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/** Модель по сценарию: ответы хода (`streams`) и ответы сжатия (`summaries`) по очереди; кончились — ошибка «лишний запрос». */
function scripted(streams: Array<LanguageModelV4StreamPart[] | Error>, summaries: Array<string | Error> = ["## Цель\nсводка"]) {
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
      if (next instanceof Error) throw next;
      return generateResult(next, { output: 20 });
    },
  });
}

function setup(model: MockLanguageModelV4, backup: MockLanguageModelV4 = scripted([])) {
  const storage: ChatStorage = createInMemoryChatStorage();
  const logError = vi.fn();
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
    logError,
  });
  return { storage, service, logError, execute };
}

/** Чат «chat-1» с перепиской из `contexts` (вопросы `u…`, ответы `a…`). */
async function chatWith(storage: ChatStorage, messages: StoredMessage[]) {
  await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  for (const message of messages) await storage.insertMessage(message);
}

async function ask(service: ReturnType<typeof setup>["service"], text: string) {
  await readAll(await service.sendMessage("anna", "chat-1", { id: "q", role: "user", parts: [{ type: "text", text }] }));
  const { messages } = await service.getHistory("anna", "chat-1");
  return messages.at(-1)!;
}

const overflowLines = (logError: ReturnType<typeof vi.fn>) =>
  logError.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("[переполнение]"));

describe("служба чата: переполнение — сжать и продолжить (US4 сц. 3–6)", () => {
  it("не влезло — история сжата, ответ complete; сводка в запросе повтора; расход ответа и сжатия записан (сц. 3, FR-013)", async () => {
    const model = scripted([overflowError(), sayDone()]);
    const { storage, service, logError } = setup(model);
    await chatWith(storage, conversation([100, 300, 600]));

    const answer = await ask(service, "новый вопрос");

    expect(answer.metadata?.status).toBe("complete");
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(await storage.listCompactions("chat-1")).toEqual([expect.objectContaining({ fromMessageId: "u1", throughMessageId: "a2" })]);
    const retried = JSON.stringify(model.doStreamCalls[1]!.prompt);
    expect(retried).toContain("<conversation_summary>");
    expect(retried).toContain("вопрос 3");
    expect(retried).not.toContain("вопрос 1");
    expect(retried).toContain("новый вопрос");
    // Ответ — 30 токенов выхода, сводка — 20.
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([expect.objectContaining({ outputTokens: 50 })]);
    expect(overflowLines(logError)).toEqual([
      `[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=начато`,
      `[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=готово`,
    ]);
    expect((await service.getHistory("anna", "chat-1")).compacting).toBe(false);
  });

  it("и после сжатия не влезло — error / context_overflow, два запроса к модели (сц. 4, SC-006)", async () => {
    const model = scripted([overflowError(), overflowError()]);
    const { storage, service } = setup(model);
    await chatWith(storage, conversation([100, 300, 600]));

    const answer = await ask(service, "новый вопрос");

    expect(answer.metadata?.status).toBe("error");
    expect(answer.metadata?.error).toEqual({ kind: "context_overflow" });
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("сжимать нечего (первый вопрос чата) — error / context_overflow, один запрос, сжатия нет (сц. 4)", async () => {
    const model = scripted([overflowError()]);
    const { storage, service, logError } = setup(model);
    await chatWith(storage, []);

    const answer = await ask(service, "огромный вопрос");

    expect(answer.metadata?.error).toEqual({ kind: "context_overflow" });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(overflowLines(logError)).toEqual([`[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=нечего сжимать`]);
  });

  it("«Too many tokens, please wait» — лимит, а не переполнение: сжатия нет (сц. 5)", async () => {
    const limited = () =>
      new MockLanguageModelV4({
        doStream: async () => {
          throw rateLimitError();
        },
      });
    const model = limited();
    const { storage, service, logError } = setup(model, limited());
    await chatWith(storage, conversation([100, 300, 600]));

    const answer = await ask(service, "новый вопрос");

    expect(answer.metadata?.error).toEqual({ kind: "rate_limited" });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(overflowLines(logError)).toEqual([]);
  });

  it("история больше окна и запрос сжатия тоже не влез — сжатие повторено с сокращёнными результатами, сводка записана (сц. 6)", async () => {
    const model = scripted([overflowError(), sayDone()], [overflowError(), "## Цель\nсводка"]);
    const { storage, service } = setup(model);
    const messages = conversation([100, 300, 600]);
    const longResult = "строка результата ".repeat(500);
    messages[1] = {
      ...messages[1]!,
      parts: [{ type: "tool-create_task", toolCallId: "t1", state: "output-available", input: { title: "все" }, output: longResult } as Part],
    };
    await chatWith(storage, messages);

    const answer = await ask(service, "новый вопрос");

    expect(answer.metadata?.status).toBe("complete");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain(longResult);
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("[Результат обрезан: показано");
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
  });
});

describe("служба чата: переполнение в продолжении после «Повторить»", () => {
  const step: Part = { type: "step-start" };
  const created = (id: string, title: string): Part =>
    ({ type: "tool-create_task", toolCallId: id, state: "output-available", input: { title }, output: `создана ${title}` }) as Part;

  /** Переписка `contexts` и оборванный ответ «a4» на «u4» с двумя выполненными вызовами. */
  async function chatWithBrokenAnswer(storage: ChatStorage) {
    const question = newStoredMessage({
      id: "u4",
      chatId: "chat-1",
      role: "user",
      parentId: "a3",
      parts: [{ type: "text", text: "создай задачи" }],
      createdAt: timeAt(100),
    });
    const broken = newStoredMessage({
      id: "a4",
      chatId: "chat-1",
      role: "assistant",
      parentId: "u4",
      parts: [step, created("c1", "Первая"), step, created("c2", "Вторая")],
      status: "error",
      error: { kind: "overloaded" },
      modelId: mockModelId,
      providerId: "mock",
      createdAt: timeAt(101),
    });
    await chatWith(storage, [...conversation([100, 300, 600]), question, broken]);
  }

  it("сжата история до вопроса, сосед-продолжение идёт следом с выполненными шагами; инструменты не повторены", async () => {
    const model = scripted([overflowError(), sayDone("Две задачи готовы")]);
    const { storage, service, execute } = setup(model);
    await chatWithBrokenAnswer(storage);

    await readAll(await service.retry("anna", "chat-1"));

    const { messages } = await service.getHistory("anna", "chat-1");
    const answer = messages.at(-1)!;
    expect(answer.id).not.toBe("a4");
    expect(answer.metadata?.status).toBe("complete");
    expect(execute).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(2);
    // Граница — по ветке до вопроса: сосед-продолжение в план не попал.
    expect(await storage.listCompactions("chat-1")).toEqual([expect.objectContaining({ throughMessageId: "a2" })]);
    const retried = model.doStreamCalls[1]!.prompt;
    expect(JSON.stringify(retried)).toContain("<conversation_summary>");
    expect(JSON.stringify(retried)).not.toContain("вопрос 1");
    expect(retried.filter((message) => message.role === "tool")).toHaveLength(2);
    expect(retried.at(-1)?.role).toBe("tool");
  });

  it("каждое сжатие — раз на ход: история, затем пересказ первого шага; снова не влезло — error / context_overflow без цикла", async () => {
    const model = scripted([overflowError(), overflowError(), overflowError()], ["## Цель\nсводка", "создана задача «Первая»"]);
    const { storage, service, logError } = setup(model);
    await chatWithBrokenAnswer(storage);

    await readAll(await service.retry("anna", "chat-1"));

    const { messages } = await service.getHistory("anna", "chat-1");
    expect(messages.at(-1)!.metadata?.error).toEqual({ kind: "context_overflow" });
    expect(model.doStreamCalls).toHaveLength(3);
    expect(model.doGenerateCalls).toHaveLength(2);
    // Третий запрос: первый шаг пересказан, второй — как есть.
    const last = JSON.stringify(model.doStreamCalls[2]!.prompt);
    expect(last).toContain("<answer_progress>");
    expect(last).not.toContain('"c1"');
    expect(last).toContain('"c2"');
    expect(overflowLines(logError).at(-1)).toBe(`[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock шаги ответа=готово`);
    // Пересказ не хранится: в ответе оба шага.
    expect(JSON.stringify(messages.at(-1)!.parts)).toContain('"c1"');
  });
});
