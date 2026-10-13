// Живая проверка на настоящей модели: расход, посчитанный расширением, сходится с тем, что назвал провайдер.
// Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createSpendingLimits } from "../../src";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

describe("расход на DeepSeek 4.1 Flash", () => {
  it(
    "стоимость хода сходится с токенами провайдера и с ценой из профиля, лимит после хода срабатывает",
    async () => {
      const storage = createInMemoryChatStorage();
      const limits = createSpendingLimits({ storage, catalog: standardCatalog, budget: () => ({ user: 0.00002 }) });
      const service = createChatService({
        storage,
        catalog: standardCatalog,
        defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
        agent: { instructions: "Ты помощник. Отвечай по-русски, коротко." },
        compaction: false,
        env: process.env,
        limits,
      });
      const chat = await service.createChat("anna");
      const question = { id: "q1", role: "user" as const, parts: [{ type: "text" as const, text: "Назови столицу Франции одним словом." }] };
      await drain(await service.sendMessage("anna", chat.id, question));

      const answer = (await service.getHistory("anna", chat.id)).messages.findLast((message) => message.role === "assistant")!;
      const usage = answer.metadata?.usage;
      expect(usage, "провайдер должен назвать расход токенов").toBeTruthy();
      const [record] = await storage.sumUsage({ ownerId: "anna" });
      expect(record).toMatchObject({ inputTokens: usage!.inputTokens, outputTokens: usage!.outputTokens });

      // Независимый пересчёт по цене профиля DeepSeek: 0,30 $ за миллион входа (кэш — 0,006), 1,20 $ за миллион выхода.
      const cachedInput = usage!.cachedInputTokens;
      const expectedUsd = ((usage!.inputTokens - cachedInput) * 0.3 + cachedInput * 0.006 + usage!.outputTokens * 1.2) / 1e6;
      const { user } = await limits.getSpending({ userId: "anna" });
      console.log(`Токены: вход ${usage!.inputTokens} (кэш ${cachedInput}), выход ${usage!.outputTokens}; расход ${user.spentUsd} $`);
      expect(user.spentUsd).toBeCloseTo(expectedUsd, 9);
      // Порядок величины: короткий вопрос стоит доли цента, но не ноль.
      expect(user.spentUsd).toBeGreaterThan(0);
      expect(user.spentUsd).toBeLessThan(0.01);

      // Бюджет 0,00002 $ мал: первый ход шёл, теперь он исчерпан — второй отказ приходит до начала хода.
      await expect(service.sendMessage("anna", chat.id, { ...question, id: "q2" })).rejects.toMatchObject({ name: "SpendingLimitReachedError" });
    },
    120_000,
  );
});
