import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AUTO_CONTINUE_NOTE, UNSENT_TOOL_CALL_REASON } from "../../../src/agent-run/auto-continue";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import { newStoredMessage } from "../../../src/conversation/types";
import type { StoredMessage, UsageRecord } from "../../../src/conversation/types";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { HANGING_TOOL_CALL_REASON } from "../../../src/tool-approval/approval-parts";
import { onFakeClock } from "../support/fake-clock";
import { createCacheMissWatch } from "../../../src/usage/cache-miss-watch";
import { finishPart, mockCatalog, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

const price = { inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: 0.1 };

/** Ошибка провайдера кусочком потока. Пауза автопродолжения — по расписанию: ход идёт на подменённых часах. */
function providerError(statusCode: number, headers: Record<string, string> = {}): APICallError {
  return new APICallError({
    message: `ответ ${statusCode}`,
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: "Provider returned error",
    responseHeaders: headers,
  });
}

/** Поток шага, оборванный ошибкой посреди текста. */
const brokenText = (text: string, error: unknown = providerError(503), id = "txt-0"): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "text-start", id },
  { type: "text-delta", id, delta: text },
  { type: "error", error },
];
const call = (id: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: "lookup", input: JSON.stringify({ query: id }) },
  finishPart("tool-calls"),
];
const answerText = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/** Модель: на каждый запрос — следующий поток по сценарию. */
function scriptedModel(script: LanguageModelV4StreamPart[][]) {
  const queue = [...script];
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = queue.shift();
      if (!next) throw new Error("лишний запрос");
      return { stream: streamOf(next) };
    },
  });
}

function lookupTool() {
  const execute = vi.fn(async ({ query }: { query: string }) => `результат ${query}`);
  return { tools: { lookup: tool({ description: "Поиск.", inputSchema: z.object({ query: z.string() }), execute }) }, execute };
}

async function autoContinueTurn(model: MockLanguageModelV4, extra: Partial<AgentTurnInput> = {}) {
  const logged: string[] = [];
  const { tools, execute } = lookupTool();
  const storage = await storageWithQuestion();
  const chunks = await onFakeClock(() =>
    readAll(
      startTurn(storage, model, {
        catalog: mockCatalog({ mock: model }, { pricing: price }),
        tools,
        ownerId: "anna",
        logError: (line) => logged.push(line),
        ...extra,
      }),
    ),
  );
  const answer = await savedAnswer(storage);
  if (!answer) throw new Error("ответ не сохранён");
  return { storage, chunks, answer, logged, execute };
}

type Prompt = MockLanguageModelV4["doStreamCalls"][number]["prompt"];
const roles = (prompt: Prompt) => prompt.map((message) => message.role);
const lastUserText = (prompt: Prompt) => {
  const message = prompt.at(-1)!;
  return message.role === "user" ? message.content.map((part) => (part.type === "text" ? part.text : "")) : [];
};
const autoContinueLines = (logged: string[]) => logged.filter((line) => line.startsWith("[автопродолжение]"));

describe("runAgentTurn: автопродолжение после обрыва посреди ответа (US7)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("сц. 1: текст и выполненный инструмент, затем временный обрыв — тот же ответ дописан, инструмент не вызван повторно, complete", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const model = scriptedModel([call("c1"), brokenText("Нашёл. Начало "), answerText("и конец.")]);

    const { answer, chunks, execute, logged, storage } = await autoContinueTurn(model);

    expect(model.doStreamCalls).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(answer.status).toBe("complete");
    expect(answer.error).toBeNull();
    expect(textOf(answer.parts)).toBe("Нашёл. Начало и конец.");
    expect(answer.parts.filter((part) => part.type === "tool-lookup")).toHaveLength(1);
    // Все части закрыты: оборванный текст получил закрывающий кусок.
    expect(answer.parts.filter((part) => part.type === "text").map((part) => part.state)).toEqual(["done", "done"]);
    // Сохранение дописывает то же сообщение: в чате вопрос и один ответ, пометки в нём нет.
    expect((await storage.listMessages("chat-1")).map((message) => message.id)).toEqual(["u1", "a1"]);
    expect(JSON.stringify(answer.parts)).not.toContain(AUTO_CONTINUE_NOTE);
    expect(autoContinueLines(logged)).toEqual([
      `[автопродолжение] чат=chat-1 модель=${mockModelId} провайдер=mock попытка=1 из 2 пауза=2000мс причина=overloaded знаков написано=14`,
    ]);
    expect(logged.some((line) => line.startsWith("[сбой провайдера]"))).toBe(false);
  });

  it("клиент получает один start, закрывающий кусок до продолжения и ни одного куска error или abort оборванной попытки", async () => {
    const model = scriptedModel([brokenText("Начало "), answerText("и конец.")]);

    const { chunks } = await autoContinueTurn(model);

    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.type === "error" || chunk.type === "abort")).toBe(false);
    expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
    expect(chunks.at(-1)).toEqual(expect.objectContaining({ type: "finish" }));
    const types = chunks.map((chunk) => chunk.type);
    const closing = chunks.findIndex((chunk) => chunk.type === "text-end");
    const continuation = chunks.findIndex((chunk) => chunk.type === "text-delta" && chunk.delta === "и конец.");
    expect(closing).toBeGreaterThan(types.indexOf("text-delta"));
    expect(closing).toBeLessThan(continuation);
  });

  it("запрос продолжения: история хода, оборванный ответ с написанным текстом, пометка последней отдельным сообщением человека", async () => {
    const model = scriptedModel([call("c1"), brokenText("Нашёл. Начало "), answerText("и конец.")]);

    await autoContinueTurn(model);

    const continuation = model.doStreamCalls[2]!.prompt;
    expect(roles(continuation)).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
    expect(continuation[4]).toMatchObject({ role: "assistant", content: [expect.objectContaining({ type: "text", text: "Нашёл. Начало " })] });
    const [note] = lastUserText(continuation);
    expect(note!.startsWith(AUTO_CONTINUE_NOTE)).toBe(true);
    // Хвост оборванного текста дословно: модель продолжает ровно со следующего знака.
    expect(note).toContain(JSON.stringify("Нашёл. Начало "));
  });

  it("шов: продолжение начато следующим пунктом списка без переноса — перенос подставлен, у клиента и в базе одинаково", async () => {
    const model = scriptedModel([brokenText("1 — 1"), answerText("2 — 4\n3 — 9")]);

    const { answer, chunks } = await autoContinueTurn(model);

    expect(textOf(answer.parts)).toBe("1 — 1\n2 — 4\n3 — 9");
    expect(chunks.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : "")).join("")).toBe("1 — 1\n2 — 4\n3 — 9");
  });

  it("в ответе для модели ещё нечего продолжать (только недописанное рассуждение) — запрос повторяется как новый, без пометки", async () => {
    const model = scriptedModel([
      [streamStart, { type: "reasoning-start", id: "r0" }, { type: "reasoning-delta", id: "r0", delta: "думаю" }, { type: "error", error: providerError(503) }],
      answerText("Ответ."),
    ]);

    const { answer } = await autoContinueTurn(model);

    expect(answer.status).toBe("complete");
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toBe(JSON.stringify(model.doStreamCalls[0]!.prompt));
  });

  describe("недописанный вызов закрывается: в базе и у клиента нет вечного «выполняется»", () => {
    /** Следующий ход в том же чате: вопрос «u2», ответ «a2». Отдаёт его запрос к модели и сохранённый ответ. */
    async function nextTurn(storage: ChatStorage, previous: StoredMessage, extra: Partial<AgentTurnInput> = {}) {
      const question = newStoredMessage({ id: "u2", chatId: "chat-1", parentId: "a1", role: "user", parts: [{ type: "text", text: "Ещё" }], createdAt: "2026-01-01T00:01:00.000Z" });
      await storage.insertMessage(question);
      const model = scriptedModel([answerText("Пожалуйста.")]);
      await onFakeClock(() =>
        readAll(
          startTurn(storage, model, {
            messageId: "a2",
            parentId: "u2",
            history: [
              { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] },
              { id: "a1", role: "assistant", parts: previous.parts },
              { id: "u2", role: "user", parts: question.parts },
            ],
            logError: () => {},
            ...extra,
          }),
        ),
      );
      const answer = (await storage.listMessages("chat-1")).find((message) => message.id === "a2")!;
      return { prompt: model.doStreamCalls[0]!.prompt, answer };
    }

    it("обрыв посреди аргументов: вызов — ошибка «аргументы не дошли» с пустым входом, в запрос продолжения не идёт, следующий ход строит запрос", async () => {
      const model = scriptedModel([
        [
          streamStart,
          ...textParts(["Ищу. "]),
          { type: "tool-input-start", id: "c2", toolName: "lookup" },
          { type: "tool-input-delta", id: "c2", delta: '{"que' },
          { type: "error", error: providerError(503) },
        ],
        answerText("Готово."),
      ]);

      const { answer, chunks, execute, storage } = await autoContinueTurn(model);

      expect(answer.status).toBe("complete");
      expect(execute).not.toHaveBeenCalled();
      const closed = answer.parts.find((part) => part.type === "tool-lookup");
      expect(closed).toMatchObject({ toolCallId: "c2", state: "output-error", input: {}, errorText: UNSENT_TOOL_CALL_REASON });
      expect((closed as { rawInput?: unknown }).rawInput).toBeUndefined();
      expect(chunks).toContainEqual(expect.objectContaining({ type: "tool-input-error", toolCallId: "c2", input: {}, errorText: UNSENT_TOOL_CALL_REASON }));
      expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).not.toContain('"c2"');

      const next = await nextTurn(storage, answer, { tools: lookupTool().tools });
      expect(next.answer.status).toBe("complete");
      expect(JSON.stringify(next.prompt)).toContain(JSON.stringify(UNSENT_TOOL_CALL_REASON).slice(1, -1));
    });

    it("обрыв сразу после готового вызова: вызов — ошибка «результат неизвестен», в базе и у клиента; следующий ход строит запрос", async () => {
      const hold = tool({ description: "Отложить.", inputSchema: z.object({ id: z.string() }) });
      const model = scriptedModel([
        [
          streamStart,
          ...textParts(["Откладываю. "]),
          { type: "tool-call", toolCallId: "h1", toolName: "hold", input: JSON.stringify({ id: "1" }) },
          { type: "error", error: providerError(503) },
        ],
        answerText("Готово."),
      ]);

      const { answer, chunks, storage } = await autoContinueTurn(model, { tools: { hold } });

      expect(answer.status).toBe("complete");
      expect(answer.parts.find((part) => part.type === "tool-hold")).toMatchObject({
        toolCallId: "h1",
        state: "output-error",
        input: { id: "1" },
        errorText: HANGING_TOOL_CALL_REASON,
      });
      expect(chunks).toContainEqual({ type: "tool-output-error", toolCallId: "h1", errorText: HANGING_TOOL_CALL_REASON });

      const next = await nextTurn(storage, answer, { tools: { hold } });
      expect(next.answer.status).toBe("complete");
      expect(JSON.stringify(next.prompt)).toContain('"toolCallId":"h1"');
    });
  });

  it("FR-041: инструкция, инструменты, настройки и сообщения до текущего ответа равны оборванной попытке побайтно", async () => {
    const model = scriptedModel([call("c1"), brokenText("Начало "), answerText("и конец.")]);

    await autoContinueTurn(model);

    const [first, broken, continuation] = model.doStreamCalls;
    for (const earlier of [first!, broken!]) {
      expect(JSON.stringify(continuation!.prompt.slice(0, 2))).toBe(JSON.stringify(earlier.prompt.slice(0, 2)));
      expect(JSON.stringify(continuation!.tools)).toBe(JSON.stringify(earlier.tools));
      expect(JSON.stringify(continuation!.providerOptions)).toBe(JSON.stringify(earlier.providerOptions));
    }
  });

  it("недописанное рассуждение остаётся в ответе закрытым, но в запросы продолжений не идёт — и после второго обрыва тоже", async () => {
    const model = scriptedModel([
      [streamStart, { type: "reasoning-start", id: "r0" }, { type: "reasoning-delta", id: "r0", delta: "думаю, как" }, { type: "error", error: providerError(503) }],
      brokenText("Ответ "),
      answerText("готов."),
    ]);

    const { answer, chunks } = await autoContinueTurn(model);

    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "reasoning")).toMatchObject({ text: "думаю, как", state: "done" });
    expect(chunks.some((chunk) => chunk.type === "reasoning-end")).toBe(true);
    for (const request of model.doStreamCalls.slice(1)) {
      expect(JSON.stringify(request.prompt)).not.toContain("думаю, как");
    }
    expect(roles(model.doStreamCalls[2]!.prompt)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("сц. 2: продолжение тоже оборвалось — второе продолжение с паузой следующего номера; третий обрыв — error с видом последней ошибки", async () => {
    const model = scriptedModel([brokenText("А"), brokenText("Б"), brokenText("В", providerError(429))]);

    const { answer, chunks, logged } = await autoContinueTurn(model);

    expect(model.doStreamCalls).toHaveLength(3);
    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind: "rate_limited" });
    expect(textOf(answer.parts)).toBe("АБВ");
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "rate_limited" }]);
    expect(autoContinueLines(logged).map((line) => line.match(/попытка=\d из 2/)![0])).toEqual(["попытка=1 из 2", "попытка=2 из 2"]);
    expect(logged.filter((line) => line.startsWith("[сбой провайдера]"))).toHaveLength(1);
  });

  it("сц. 2: два обрыва, затем ответ — complete", async () => {
    const model = scriptedModel([brokenText("А"), brokenText("Б"), answerText("В")]);
    const { answer } = await autoContinueTurn(model);
    expect(answer.status).toBe("complete");
    expect(textOf(answer.parts)).toBe("АБВ");
  });

  it("пауза — 2 с перед первым продолжением, 5 с перед вторым, плюс разброс; запроса до конца паузы нет (FR-038)", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const noHeaders = providerError(503, {});
    const model = scriptedModel([brokenText("А", noHeaders), brokenText("Б", noHeaders), answerText("В")]);
    const storage = await storageWithQuestion();
    const logged: string[] = [];
    const reading = readAll(startTurn(storage, model, { logError: (line) => logged.push(line) }));

    await vi.advanceTimersByTimeAsync(1_999);
    expect(model.doStreamCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(model.doStreamCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(model.doStreamCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await reading;

    expect(model.doStreamCalls).toHaveLength(3);
    expect(autoContinueLines(logged).map((line) => line.match(/пауза=\d+мс/)![0])).toEqual(["пауза=2000мс", "пауза=5000мс"]);
    expect((await savedAnswer(storage))!.status).toBe("complete");
  });

  it("сц. 3, FR-044: «Стоп» на паузе обрывает её сразу — stopped, запросов к модели больше нет, написанное сохранено", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const model = scriptedModel([brokenText("Начало", providerError(503, {})), answerText("лишнее")]);
    const storage = await storageWithQuestion();
    const reading = readAll(startTurn(storage, model, { abortSignal: controller.signal, logError: () => {} }));

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    // Часы дальше не идут: если «Стоп» пауза не оборвал, ход так и не закончится.
    const chunks = await reading;

    expect(model.doStreamCalls).toHaveLength(1);
    const answer = (await savedAnswer(storage))!;
    expect(answer.status).toBe("stopped");
    expect(textOf(answer.parts)).toBe("Начало");
    expect(chunks.at(-1)).toEqual({ type: "abort" });
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
  });

  it.each([
    [401, "invalid_key"],
    [402, "insufficient_funds"],
    [400, "other"],
  ] as const)("сц. 4: обрыв ошибкой с кодом %i (%s) — автопродолжения нет, error", async (status, kind) => {
    const model = scriptedModel([brokenText("Начало", providerError(status)), answerText("лишнее")]);

    const { answer, logged } = await autoContinueTurn(model);

    expect(model.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind });
    expect(autoContinueLines(logged)).toEqual([]);
  });

  it("в оборванной попытке остался запрос подтверждения — автопродолжения нет, ход заканчивается как сейчас (FR-044)", async () => {
    const remove = tool({ description: "Удалить.", inputSchema: z.object({ id: z.string() }), needsApproval: true, execute: async () => "удалено" });
    const model = scriptedModel([
      [
        streamStart,
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Удаляю" },
        { type: "text-end", id: "t" },
        { type: "tool-call", toolCallId: "d1", toolName: "remove", input: JSON.stringify({ id: "1" }) },
        { type: "error", error: providerError(503) },
      ],
      answerText("лишнее"),
    ]);

    const { answer, logged } = await autoContinueTurn(model, { tools: { remove } });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("error");
    expect(autoContinueLines(logged)).toEqual([]);
  });

  it("сц. 5: у модели есть запасной — продолжение у того же провайдера, ответ записан с ним, расход всех попыток в одной записи (FR-042, FR-043)", async () => {
    const primary = scriptedModel([call("c1"), brokenText("Начало "), answerText("и конец.")]);
    const backup = scriptedModel([answerText("от запасного")]);
    const storage = await storageWithQuestion();
    const written: UsageRecord[] = [];
    const recording = {
      ...storage,
      insertUsageRecord: async (record: UsageRecord) => {
        written.push(record);
        await storage.insertUsageRecord(record);
      },
    };
    const { tools } = lookupTool();

    const chunks = await readAll(
      startTurn(recording, primary, {
        catalog: mockCatalog({ mock: primary, "mock-backup": backup }, { pricing: price }),
        providerFallback: {},
        tools,
        ownerId: "anna",
        logError: () => {},
      }),
    );

    const answer = (await savedAnswer(storage))!;
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(answer.status).toBe("complete");
    expect(answer.providerId).toBe("mock");
    // Шаг с инструментом оборванной попытки и продолжение: по 100 на входе и 30 на выходе. Оборванный шаг «Начало »
    // провайдер не досчитал — он оценён (FR-051): вход не меньше 100 + 30, весь прошлый вход из кэша, 6 букв кириллицы и пробел — 4 токена.
    const broken = answer.usage!.inputTokens - 200;
    expect(broken).toBeGreaterThanOrEqual(130);
    expect(answer.usage).toMatchObject({ outputTokens: 64, cachedInputTokens: 60 + 100 + 60, estimated: true });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ providerId: "mock", modelId: mockModelId, inputTokens: 200 + broken, outputTokens: 64, estimated: true });
    // Деньги за все три шага: шаги прежней попытки не теряются (по шагу: 40 без кэша, 60 из кэша, 30 на выходе).
    const brokenCost = (broken - 100) * 1 + 100 * 0.1 + 4 * 2;
    expect(written[0]!.costUsd).toBeCloseTo((2 * (40 * 1 + 60 * 0.1 + 30 * 2) + brokenCost) / 1_000_000, 12);
    expect(chunks.at(-2)).toEqual({ type: "message-metadata", messageMetadata: expect.objectContaining({ usage: expect.objectContaining({ outputTokens: 64 }) }) });
  });

  describe("кэш: продолжение не даёт ложного промаха (FR-041)", () => {
    const bigFinish = (input: number, cached: number, reason: "stop" | "tool-calls" = "stop"): LanguageModelV4StreamPart => ({
      type: "finish",
      finishReason: { unified: reason, raw: reason },
      usage: { inputTokens: { total: input, noCache: input - cached, cacheRead: cached, cacheWrite: 0 }, outputTokens: { total: 30, text: 30, reasoning: 0 } },
    });
    const bigCall: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: JSON.stringify({ query: "c1" }) },
      bigFinish(5_000, 4_000, "tool-calls"),
    ];

    it("продолжение прочитало начало из кэша — строки [промах кэша] нет", async () => {
      const model = scriptedModel([bigCall, brokenText("Начало "), [streamStart, ...textParts(["конец"]), bigFinish(6_000, 5_000)]]);
      const logged: string[] = [];
      const cacheMissWatch = createCacheMissWatch({ logError: (line) => logged.push(line) });

      const { answer } = await autoContinueTurn(model, { cacheMissWatch });

      expect(answer.status).toBe("complete");
      expect(logged.filter((line) => line.startsWith("[промах кэша]"))).toEqual([]);
    });

    it("продолжение мимо кэша — промах замечен: следилка сравнивает продолжение с оборванной попыткой", async () => {
      const model = scriptedModel([bigCall, brokenText("Начало "), [streamStart, ...textParts(["конец"]), bigFinish(6_000, 100)]]);
      const logged: string[] = [];
      const cacheMissWatch = createCacheMissWatch({ logError: (line) => logged.push(line) });

      await autoContinueTurn(model, { cacheMissWatch });

      expect(logged.filter((line) => line.startsWith("[промах кэша]"))).toHaveLength(1);
    });
  });

  it("SC-010: 20 из 20 — обрыв посреди текста после выполненного инструмента, затем ответ: complete, начало одно, инструмент вызван раз", async () => {
    for (let run = 0; run < 20; run++) {
      const model = scriptedModel([call("c1"), brokenText("Начало "), answerText("и конец.")]);
      const { answer, chunks, execute } = await autoContinueTurn(model);
      expect(answer.status).toBe("complete");
      expect(textOf(answer.parts)).toBe("Начало и конец.");
      expect(execute).toHaveBeenCalledTimes(1);
      expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
      const streamedText = chunks.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : "")).join("");
      expect(streamedText).toBe("Начало и конец.");
    }
  });
});
