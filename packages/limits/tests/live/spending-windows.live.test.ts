// Живая проверка окон лимитов и правил хода на настоящей модели (DeepSeek 4.1 Flash у DeepSeek): скользящее окно открывается
// первым ходом, потолок вызовов инструментов заканчивает ход итогом, а не обрывом, порог шлёт событие, запас на старт не
// пускает следующий ход. Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
// Запуск: `pnpm test:live spending-windows`.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import { createSpendingLimits } from "../../src";
import type { SpendingThresholdEvent } from "../../src";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

describe("окна лимитов и правила хода на DeepSeek 4.1 Flash", () => {
  it(
    "потолок вызовов: ход кончается итогом; окно 5 часов открыто первым ходом; порог и запас срабатывают",
    async () => {
      const storage = createInMemoryChatStorage();
      const events: SpendingThresholdEvent[] = [];
      const lookups: string[] = [];
      const limits = createSpendingLimits({
        storage,
        catalog: standardCatalog,
        timeZone: "Europe/Moscow",
        windows: [
          { id: "5h", scope: "user", kind: "rolling", hours: 5, limitUsd: 0.0004 },
          { id: "week", scope: "user", kind: "calendar", unit: "week", limitUsd: 1 },
          { id: "service-day", scope: "service", kind: "calendar", unit: "day", limitUsd: 20 },
        ],
        // Запас больше лимита окна 5 часов за вычетом одного хода: после первого хода следующий не начнётся.
        turn: { minRemainingUsd: 0.0003, maxToolCalls: 2, maxCostUsd: 0.1 },
        thresholds: [0.01],
        onThreshold: (event) => void events.push(event),
      });
      const service = createChatService({
        storage,
        catalog: standardCatalog,
        defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
        agent: {
          instructions:
            "Ты помощник в тестовом стенде. Чтобы узнать погоду, вызывай weather по одному городу за вызов. Вызывай инструмент для каждого города из вопроса, по очереди. Отвечай по-русски, коротко.",
          tools: {
            weather: tool({
              description: "Погода в одном городе.",
              inputSchema: jsonSchema<{ city: string }>({ type: "object", properties: { city: { type: "string" } }, required: ["city"] }),
              execute: async ({ city }) => {
                lookups.push(city);
                return `В городе ${city} +12, облачно.`;
              },
            }),
          },
        },
        compaction: false,
        env: process.env,
        limits,
      });
      const chat = await service.createChat("anna");
      const cities = "Москва, Казань, Пермь, Омск, Томск, Сочи";
      const question = { id: "q1", role: "user" as const, parts: [{ type: "text" as const, text: `Какая погода в городах: ${cities}? Проверь каждый.` }] };
      await drain(await service.sendMessage("anna", chat.id, question));

      const answer = (await service.getHistory("anna", chat.id)).messages.findLast((message) => message.role === "assistant")!;
      const text = answer.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("");
      console.log(`Вызовов инструмента: ${lookups.length} (${lookups.join(", ")}); итог: ${text.slice(0, 200)}`);
      // Потолок 2 вызова; шаг, начатый до потолка, доделывается (модель может вызвать несколько за шаг) — но не все шесть городов.
      expect(lookups.length).toBeGreaterThanOrEqual(1);
      expect(lookups.length).toBeLessThan(6);
      expect(answer.metadata?.status).toBe("complete");
      expect(text.trim().length, "ход должен закончиться итогом").toBeGreaterThan(0);

      const report = await limits.getSpending({ userId: "anna" });
      const fiveHours = report.windows!.find((window) => window.id === "5h")!;
      console.log(`Окно 5 ч: потрачено ${fiveHours.spentUsd} $ из ${fiveHours.limitUsd} $, начало ${fiveHours.start}, сброс ${fiveHours.resetsAt}`);
      expect(fiveHours.start).not.toBeNull();
      expect(Date.parse(fiveHours.resetsAt!) - Date.parse(fiveHours.start!)).toBe(5 * 3_600_000);
      expect(fiveHours.spentUsd).toBeGreaterThan(0);

      // Пороги шлются фоном после записи расхода.
      await expect.poll(() => events.map((event) => event.windowId).sort(), { timeout: 10_000 }).toContain("5h");

      const status = await limits.status({ userId: "anna", chatId: chat.id });
      console.log(`Состояние для браузера: ${JSON.stringify(status)}`);
      expect(JSON.stringify(status)).not.toMatch(/usd|Usd|spent/);
      if (fiveHours.limitUsd - fiveHours.spentUsd < 0.0003) {
        expect(status).toMatchObject({ state: "exhausted", windowId: "5h" });
        await expect(service.sendMessage("anna", chat.id, { ...question, id: "q2" })).rejects.toMatchObject({ name: "SpendingLimitReachedError", windowId: "5h" });
      }
    },
    180_000,
  );
});
