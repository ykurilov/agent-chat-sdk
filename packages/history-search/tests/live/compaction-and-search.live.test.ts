// Живая проверка на настоящей модели: переписка сжимается сама, сводка из шести разделов, деталь находится поиском.
// Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createHistorySearchTools } from "../../src/create-history-search-tools";
import { historySearchInstructions } from "../../src/instructions";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

// Деталь в длинном списке: в сводку она попадает не всегда, так что агенту, скорее всего, придётся искать.
const ORDER_NUMBER = "K-90417";
const ORDERS = `A-1017 — чайник, B-2290 — плед, C-3345 — настольная лампа, D-4471 — набор ножей, E-5528 — рюкзак, ${ORDER_NUMBER} — паяльник, G-7714 — коврик для йоги, H-8826 — термос`;
const SECTIONS = ["Цель", "Решения", "Факты", "Файлы и результаты", "Незакрытые задачи", "Где остановились"];

// Сводка, в которой нет точных чисел и кодов: деталь можно узнать только из старой переписки.
const SUMMARY_WITHOUT_EXACT_VALUES = `Сожми переписку в сводку из шести разделов с заголовками «## Цель», «## Решения», «## Факты», «## Файлы и результаты», «## Незакрытые задачи», «## Где остановились». Пиши только общий смысл. Никаких номеров, кодов, артикулов и других точных значений в сводке быть не должно: вместо них пиши «(точное значение — в старой переписке)».`;

async function runConversation(instruction?: string) {
  const storage = createInMemoryChatStorage();
  const historySearch = createHistorySearchTools({ storage });
  const service = createChatService({
    storage,
    catalog: standardCatalog,
    defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
    agent: {
      instructions: `Ты помощник. Отвечай по-русски.\n${historySearchInstructions}`,
      tools: historySearch,
      maxSteps: 6,
    },
    compaction: { thresholdTokens: 1500, tailTokens: 300, summaryCeilingTokens: 700, ...(instruction && { instruction }) },
    env: process.env,
  });
  const chat = await service.createChat("anna");

  async function ask(id: string, text: string) {
    const stream = await service.sendMessage("anna", chat.id, { id, role: "user", parts: [{ type: "text", text }] });
    for await (const _chunk of stream) {
      // ход дочитывается до конца
    }
  }

  await ask("q1", `Вот заказы клиента, номера точные: ${ORDERS}. Ответь одним словом: «принято».`);
  const topics = ["парусный спорт", "выпечку хлеба", "устройство мостов"];
  for (const [index, topic] of topics.entries()) {
    await ask(`q${index + 2}`, `Расскажи подробно, примерно на 250 слов, про ${topic}.`);
  }

  // Сжатие идёт фоном после ответа.
  await expect
    .poll(async () => (await service.getCompactions("anna", chat.id)).compactions.length, { timeout: 120_000, interval: 1_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await service.getCompactions("anna", chat.id)).compacting, { timeout: 120_000, interval: 500 })
    .toBe(false);
  const [first] = (await service.getCompactions("anna", chat.id)).compactions;

  await ask("q5", "Какой номер у заказа с паяльником? Ответь одной строкой, только номер.");
  const { messages } = await service.getHistory("anna", chat.id);
  const answer = messages.findLast((message) => message.role === "assistant")?.parts ?? [];
  return {
    summary: first?.summary ?? "",
    fromMessageId: first?.fromMessageId,
    text: answer.map((part) => (part.type === "text" ? part.text : "")).join(""),
    searched: answer.some((part) => part.type === "tool-search_earlier_conversation"),
  };
}

describe("сжатие истории и поиск по старой переписке на DeepSeek 4.1 Flash", () => {
  it(
    "малый порог: сводка с шестью разделами, деталь переписки не теряется",
    async () => {
      const result = await runConversation();
      expect(result.fromMessageId, "сжатие началось с первого сообщения").toBe("q1");
      for (const section of SECTIONS) expect(result.summary, `раздел «${section}» в сводке`).toContain(section);
      console.log(`Поиск вызван: ${result.searched ? "да" : "нет"}; номер в сводке: ${result.summary.includes(ORDER_NUMBER) ? "да" : "нет"}`);
      expect(result.text, `ответ: ${result.text}`).toContain(ORDER_NUMBER);
    },
    420_000,
  );

  it(
    "в сводке нет точного номера: агент ищет его в старой переписке и находит",
    async () => {
      const result = await runConversation(SUMMARY_WITHOUT_EXACT_VALUES);
      expect(result.summary, "в сводке номера нет").not.toContain(ORDER_NUMBER);
      expect(result.searched, "агент вызвал поиск по старой переписке").toBe(true);
      expect(result.text, `ответ: ${result.text}`).toContain(ORDER_NUMBER);
    },
    420_000,
  );
});
