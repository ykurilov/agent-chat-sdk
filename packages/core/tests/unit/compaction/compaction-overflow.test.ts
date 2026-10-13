import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { resolveCompactionSettings } from "../../../src/compaction/compaction-settings";
import { createCompactionService } from "../../../src/compaction/compaction-service";
import { answerStepsTask } from "../../../src/compaction/answer-steps";
import { summaryFrame } from "../../../src/compaction/compaction-task";
import type { CompactionSettings } from "../../../src/compaction/compaction-settings";
import { newStoredMessage } from "../../../src/conversation/types";
import type { AgentChatMessage, StoredMessage } from "../../../src/conversation/types";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { compactionRecord, conversation, timeAt } from "../support/compaction-fixtures";
import { generateResult, mockCatalog, mockEnv, mockModelId } from "../support/mock-model";

const choice = { modelId: mockModelId, providerId: "mock" };
/** Порог высокий: сжатие при переполнении на него не смотрит. */
const settingsInput: CompactionSettings = { thresholdTokens: 900, tailTokens: 100, summaryCeilingTokens: 100 };

function summarizer(results: Array<string | Error> = ["## Цель\nсводка"]) {
  const queue = [...results];
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      if (next instanceof Error) throw next;
      return generateResult(next, { output: 20 });
    },
  });
}

/** Модель сжатия, которая держит сводку, пока тест не отпустит. */
function heldSummarizer() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      await held;
      return generateResult("## Цель\nсводка", { output: 20 });
    },
  });
  return { model, release };
}

const badRequest = () =>
  new APICallError({ message: "ответ 400", url: "https://provider.test/v1", requestBodyValues: {}, statusCode: 400, responseBody: "bad request" });

/** Ветка из `contexts` и новый вопрос, на котором ход упёрся в окно модели. */
async function setup(input: { contexts: Array<number | null>; model?: MockLanguageModelV4; settings?: CompactionSettings | false; now?: () => number }) {
  const storage: ChatStorage = createInMemoryChatStorage();
  await storage.createChat({ id: "chat-1", ownerId: "anna", ...choice });
  const stored = conversation(input.contexts);
  for (const message of stored) await storage.insertMessage(message);
  const question = newStoredMessage({
    id: "q",
    chatId: "chat-1",
    role: "user",
    parentId: stored.at(-1)?.id ?? null,
    parts: [{ type: "text", text: "новый вопрос" }],
    createdAt: timeAt(500),
  });
  await storage.insertMessage(question);
  const model = input.model ?? summarizer();
  const logError = vi.fn();
  const service = createCompactionService({
    storage,
    catalog: mockCatalog({ mock: model }),
    env: mockEnv,
    agent: { instructions: "Ты помощник." },
    settings: resolveCompactionSettings(input.settings ?? settingsInput),
    logError,
    ...(input.now && { now: input.now }),
  });
  const branch: StoredMessage[] = [...stored, question];
  return { storage, model, service, logError, branch };
}

const overflowLines = (logError: ReturnType<typeof vi.fn>) =>
  logError.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("[переполнение]"));

describe("compactForOverflow: сжатие, когда ход упёрся в окно модели (FR-012)", () => {
  it("сжимает без порога: граница по плану ветки до вопроса, возвращает историю для ответа, расход записан, строки журнала", async () => {
    const { storage, model, service, logError, branch } = await setup({ contexts: [100, 300, 600] });

    const history = await service.compactForOverflow({ chatId: "chat-1", branch, choice });

    expect(model.doGenerateCalls).toHaveLength(1);
    const [record] = await storage.listCompactions("chat-1");
    expect(record).toMatchObject({ fromMessageId: "u1", throughMessageId: "a2", summary: "## Цель\nсводка" });
    expect(history?.map((message) => message.id)).toEqual(["u3", "a3", "q"]);
    expect(history?.[0]?.parts[0]).toEqual({ type: "text", text: summaryFrame("## Цель\nсводка") });
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([expect.objectContaining({ modelId: mockModelId, providerId: "mock", outputTokens: 20 })]);
    expect(overflowLines(logError)).toEqual([
      `[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=начато`,
      `[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=готово`,
    ]);
  });

  it("план пуст (до вопроса один ответ) — сжимается вся переписка до вопроса", async () => {
    const { storage, service, branch } = await setup({ contexts: [800] });

    const history = await service.compactForOverflow({ chatId: "chat-1", branch, choice });

    expect((await storage.listCompactions("chat-1"))[0]).toMatchObject({ fromMessageId: "u1", throughMessageId: "a1" });
    expect(history?.map((message) => message.id)).toEqual(["q"]);
    expect(history?.[0]?.parts).toEqual([
      { type: "text", text: summaryFrame("## Цель\nсводка") },
      { type: "text", text: "новый вопрос" },
    ]);
  });

  it("пауза после неудачного сжатия не мешает (часы подменены)", async () => {
    const clock = { now: Date.parse("2026-01-01T00:10:00.000Z") };
    const { storage, service, branch } = await setup({
      contexts: [100, 300, 600],
      model: summarizer([badRequest(), "## Цель\nсводка"]),
      now: () => clock.now,
    });
    expect(await service.compactNow("chat-1", choice)).toBe("failed");
    clock.now += 1000;

    const history = await service.compactForOverflow({ chatId: "chat-1", branch, choice });

    expect(history).not.toBeNull();
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
  });

  it("сжимать нечего (первый вопрос или всё до вопроса уже в сводке) — null без запроса к модели", async () => {
    const first = await setup({ contexts: [] });
    expect(await first.service.compactForOverflow({ chatId: "chat-1", branch: first.branch, choice })).toBeNull();
    expect(first.model.doGenerateCalls).toHaveLength(0);
    expect(overflowLines(first.logError)).toEqual([`[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=нечего сжимать`]);

    const covered = await setup({ contexts: [800] });
    await covered.storage.insertCompaction(compactionRecord({ id: "c1", throughMessageId: "a1" }));
    expect(await covered.service.compactForOverflow({ chatId: "chat-1", branch: covered.branch, choice })).toBeNull();
    expect(covered.model.doGenerateCalls).toHaveLength(0);
  });

  it("сжатие не вышло — null и строка «не вышло»", async () => {
    const { storage, service, logError, branch } = await setup({ contexts: [100, 300, 600], model: summarizer([badRequest()]) });

    expect(await service.compactForOverflow({ chatId: "chat-1", branch, choice })).toBeNull();

    expect(await storage.listCompactions("chat-1")).toHaveLength(0);
    expect(overflowLines(logError).at(-1)).toBe(`[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=не вышло`);
  });

  it("автосжатие выключено — null без запроса, строка «выключено»", async () => {
    const { model, service, logError, branch } = await setup({ contexts: [100, 300, 600], settings: false });

    expect(await service.compactForOverflow({ chatId: "chat-1", branch, choice })).toBeNull();

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(overflowLines(logError)).toEqual([`[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=выключено`]);
  });

  it("пока идёт, признак «идёт сжатие» выставлен; «Стоп» обрывает ожидание сразу, сжатие доделывается фоном", async () => {
    const held = heldSummarizer();
    const { storage, service, branch } = await setup({ contexts: [100, 300, 600], model: held.model });
    const stop = new AbortController();

    const waiting = service.compactForOverflow({ chatId: "chat-1", branch, choice, abortSignal: stop.signal });
    await vi.waitFor(() => expect(held.model.doGenerateCalls).toHaveLength(1));
    expect(service.isCompacting("chat-1")).toBe(true);
    stop.abort(new DOMException("Стоп", "AbortError"));

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(service.isCompacting("chat-1")).toBe(true);
    held.release();
    await vi.waitFor(() => expect(service.isCompacting("chat-1")).toBe(false));
    expect(await storage.listCompactions("chat-1")).toHaveLength(1);
  });

  it("сжатие чата уже идёт — ход ждёт его; граница не дошла до вопроса — один раз дожимает сжатием для переполнения", async () => {
    const held = heldSummarizer();
    const { storage, service, logError, branch } = await setup({ contexts: [100, 300, 600], model: held.model });
    const running = service.compactNow("chat-1", choice);
    await vi.waitFor(() => expect(held.model.doGenerateCalls).toHaveLength(1));

    const waiting = service.compactForOverflow({ chatId: "chat-1", branch, choice });
    held.release();
    const history = await waiting;

    expect(await running).toBe("compacted");
    // Обычное сжатие оставило хвост (граница a2), второе — для переполнения — дошло до вопроса.
    expect(held.model.doGenerateCalls).toHaveLength(2);
    expect((await storage.listCompactions("chat-1")).map((record) => record.throughMessageId)).toEqual(["a2", "a3"]);
    expect(history?.map((message) => message.id)).toEqual(["q"]);
    expect(overflowLines(logError)).toEqual([
      `[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=начато`,
      `[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock сжатие=готово`,
    ]);
  });

  it("сжатие чата уже идёт и не вышло — ход один раз сжимает сам", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const results: Array<string | Error> = [badRequest(), "## Цель\nсводка"];
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        await held;
        const next = results.shift()!;
        if (next instanceof Error) throw next;
        return generateResult(next, { output: 20 });
      },
    });
    const { storage, service, branch } = await setup({ contexts: [100, 300, 600], model });
    const running = service.compactNow("chat-1", choice);
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(1));

    const waiting = service.compactForOverflow({ chatId: "chat-1", branch, choice });
    release();

    expect(await running).toBe("failed");
    expect(await waiting).not.toBeNull();
    expect(await storage.listCompactions("chat-1")).toEqual([expect.objectContaining({ throughMessageId: "a2" })]);
  });
});

describe("compactAnswerSteps: пересказ первых шагов текущего ответа (сжатие внутри хода)", () => {
  const history: AgentChatMessage[] = [{ id: "q", role: "user", parts: [{ type: "text", text: "новый вопрос" }] }];
  const steps: AgentChatMessage["parts"] = [
    { type: "step-start" },
    { type: "dynamic-tool", toolName: "lookup", toolCallId: "c1", state: "output-available", input: { query: "все" }, output: "300 задач" },
  ];

  it("пересказ — запросом сжатия: история, затем первые шаги ответа, затем задание; расход записан, строки журнала", async () => {
    const { storage, model, service, logError } = await setup({ contexts: [], model: summarizer(["сделан поиск: 300 задач"]) });

    const summary = await service.compactAnswerSteps({ chatId: "chat-1", history, steps, choice });

    expect(summary).toBe("сделан поиск: 300 задач");
    const prompt = model.doGenerateCalls[0]!.prompt;
    expect(prompt.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: answerStepsTask(100) }] });
    expect(prompt.map((message) => message.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(await storage.listCompactions("chat-1")).toHaveLength(0);
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([expect.objectContaining({ outputTokens: 20 })]);
    expect(overflowLines(logError)).toEqual([
      `[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock шаги ответа=начато`,
      `[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock шаги ответа=готово`,
    ]);
  });

  it("не вышло — null и строка «не вышло»", async () => {
    const { service, logError } = await setup({ contexts: [], model: summarizer([badRequest()]) });
    expect(await service.compactAnswerSteps({ chatId: "chat-1", history, steps, choice })).toBeNull();
    expect(overflowLines(logError).at(-1)).toBe(`[переполнение] чат=chat-1 модель=${mockModelId} провайдер=mock шаги ответа=не вышло`);
  });

  it("сжатие выключено — null без запроса", async () => {
    const { model, service } = await setup({ contexts: [], settings: false });
    expect(await service.compactAnswerSteps({ chatId: "chat-1", history, steps, choice })).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
