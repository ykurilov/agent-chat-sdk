import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { resolveCompactionSettings } from "../../../src/compaction/compaction-settings";
import { createCompactionService } from "../../../src/compaction/compaction-service";
import type { ChatStorage } from "../../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { conversation } from "../support/compaction-fixtures";
import { generateResult, mockCatalog, mockEnv, mockModelId } from "../support/mock-model";

const choice = { modelId: mockModelId, providerId: "mock" };

const providerError = (statusCode: number, responseBody: string) =>
  new APICallError({
    message: `ответ ${statusCode}`,
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
    // Пауза в 1 мс по просьбе провайдера: тест не ждёт секунду обычной паузы.
    responseHeaders: { "retry-after-ms": "1" },
  });

/** Модель сжатия: ответы `doGenerate` по очереди, последний повторяется. */
function summarizer(results: Array<string | Error>) {
  const queue = [...results];
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      if (next instanceof Error) throw next;
      return generateResult(next, { output: 20 });
    },
  });
}

async function setup(model: MockLanguageModelV4) {
  const storage: ChatStorage = createInMemoryChatStorage();
  await storage.createChat({ id: "chat-1", ownerId: "anna", ...choice });
  for (const message of conversation([100, 300, 600])) await storage.insertMessage(message);
  const logError = vi.fn();
  const service = createCompactionService({
    storage,
    catalog: mockCatalog({ mock: model }),
    env: mockEnv,
    agent: { instructions: "Ты помощник." },
    settings: resolveCompactionSettings({ thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 }),
    logError,
  });
  return { storage, service, logError };
}

describe("сжатие: тихие повторы и журнал сбоя", () => {
  it("запрос сжатия получил 503, затем сводку — сводка записана (SC-003: 20 из 20)", async () => {
    for (let run = 0; run < 20; run++) {
      const model = summarizer([providerError(503, "занято"), "## Цель\nсводка"]);
      const { storage, service, logError } = await setup(model);
      expect(await service.compactNow("chat-1", choice)).toBe("compacted");
      expect(model.doGenerateCalls).toHaveLength(2);
      expect((await storage.listCompactions("chat-1")).map((record) => record.summary)).toEqual(["## Цель\nсводка"]);
      expect(logError.mock.calls.map(([line]) => String(line))).toEqual([
        "[повтор] чат=chat-1 модель=mock-model провайдер=mock попытка=2 код=503 пауза=1мс",
      ]);
    }
  });

  it("сбой провайдера при сжатии — строка [сбой провайдера] с кодом и телом, ключа нет (FR-008)", async () => {
    const body = `{"error":"bad request","echo":"${mockEnv.MOCK_API_KEY}"}`;
    const model = summarizer([providerError(400, body)]);
    const { storage, service, logError } = await setup(model);
    expect(await service.compactNow("chat-1", choice)).toBe("failed");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(await storage.listCompactions("chat-1")).toEqual([]);
    expect(logError.mock.calls.map(([line]) => String(line))).toEqual([
      '[сбой провайдера] чат=chat-1 модель=mock-model провайдер=mock вид=other код=400 имя=AI_APICallError тело={"error":"bad request","echo":"[скрыто]"}',
    ]);
  });

  it("сводка оборвана по длине — не сбой провайдера: прежняя строка о сжатии", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("## Цель\nобры", { finish: "length", output: 20 }) });
    const { service, logError } = await setup(model);
    expect(await service.compactNow("chat-1", choice)).toBe("failed");
    expect(logError.mock.calls.map(([line]) => String(line))).toEqual(["Сжатие чата chat-1 не удалось: Не удалось сжать историю: сводка оборвана по длине"]);
  });
});
