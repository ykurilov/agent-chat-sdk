// Живая проверка FR-058: «Стоп» посреди ответа у OpenRouter (Gemini 3.8 Flash) — сразу оценка «примерно», а через
// 15–40 с фоновая сверка узнаёт у OpenRouter настоящий расход генерации по номеру из заголовка `x-generation-id` и
// дописывает поправку `answer_correction`. Проверяет, что номер доходит сквозь обёртки модели, а сумма записей ответа —
// настоящий расход генерации. Тест платный (один короткий оборванный ответ, меньше $0,01). Ключ — только из окружения
// (`pnpm secrets:load`). Запуск: `pnpm test:live openrouter-generation-usage`.
import { describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "gemini-3.8-flash";
const providerId = "openrouter";
const ownerId = "generation-usage-tester";

describe("OpenRouter: настоящий расход оборванного ответа (FR-058)", () => {
  it("«Стоп» после первых кусков: оценка, затем поправка до настоящего расхода", async () => {
    const storage = createInMemoryChatStorage();
    const logged: string[] = [];
    const service = createChatService({
      storage,
      catalog: standardCatalog,
      defaultChoice: { modelId, providerId },
      agent: { instructions: "Ты пишешь длинные подробные рассказы." },
      env: process.env,
      logError: (line) => logged.push(line),
    });
    const chat = await service.createChat(ownerId);
    await service.setModel(ownerId, chat.id, { modelId, providerId, reasoning: "minimal" });
    const stream = await service.sendMessage(ownerId, chat.id, {
      id: "u-generation-usage",
      role: "user",
      parts: [{ type: "text", text: "Напиши рассказ про склад, не меньше 1500 слов." }],
    });
    const reader = stream.getReader();
    let deltas = 0;
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      if (read.value.type === "text-delta" && ++deltas === 3) await service.stop(ownerId, chat.id);
    }

    const answerRecords = await storage.sumUsage({ chatId: chat.id, source: "answer" });
    expect(answerRecords).toHaveLength(1);
    let corrections = await storage.sumUsage({ chatId: chat.id, source: "answer_correction" });
    for (let waited = 0; corrections.length === 0 && waited < 150_000; waited += 2_000) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      corrections = await storage.sumUsage({ chatId: chat.id, source: "answer_correction" });
    }
    const estimate = answerRecords[0]!;
    const correction = corrections[0];
    process.stdout.write(`[generation-usage-result] ${JSON.stringify({ estimate, correction, logged })}\n`);

    expect(correction, "поправка записана").toBeDefined();
    // Настоящий расход генерации: вход — запрос целиком, выход — хотя бы написанное до «Стопа».
    expect(estimate.inputTokens + correction!.inputTokens).toBeGreaterThan(0);
    expect(estimate.outputTokens + correction!.outputTokens).toBeGreaterThan(0);
    expect(estimate.costUsd + correction!.costUsd).toBeGreaterThan(0);
  }, 240_000);
});
