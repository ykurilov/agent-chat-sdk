// Живая проверка заголовков раздумий (фича 106): ход со сборкой на DeepSeek 4.1 Flash (с раздумьями) — несколько шагов
// с раздумьями и инструментами; заголовки пересказывает DeepSeek 4.1 Flash без раздумий. Падает от поломок нашей
// стороны: заголовков нет совсем, они не по-русски, длиннее 6 слов или с кодом, нет расхода `thought_title`.
// Осмысленность заголовков и цена — в отчёт. Не больше ~15 вызовов модели: ход до 6 шагов, заголовков до 6.
// Ключ — только из окружения (`.env.local`). Запуск: `pnpm test:live thought-titles`.
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { fitsLanguage } from "../../src/thought-titles/thought-title-text";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY в окружении");

const model = { modelId: "deepseek-4.1-flash", providerId: "deepseek" } as const;

const files: Record<string, string> = {
  "README.md": "# Крестики-нолики\nИгра для двоих на поле 3×3. Код — в src/game.ts, тесты — npm test.",
  "src/game.ts": "export function newGame() {\n  // TODO\n}\n",
};

const tools = {
  read_file: tool({
    description: "Прочитать файл проекта",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => files[path] ?? "нет такого файла",
  }),
  write_file: tool({
    description: "Записать файл проекта целиком",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => {
      files[path] = content;
      return "записано";
    },
  }),
  run_tests: tool({
    description: "Запустить тесты проекта",
    inputSchema: z.object({}),
    execute: async () => "3 теста прошли: победа по строке, по диагонали, ничья",
  }),
};

describe("заголовки раздумий вживую", () => {
  it("ход со сборкой: заголовки по-русски, коротко, без кода; цена — в отчёт", async () => {
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog: standardCatalog,
      defaultChoice: model,
      agent: {
        instructions: "Ты разработчик. Делай задачу инструментами по шагам: прочитай, напиши код, запусти тесты. Отвечай по-русски, коротко.",
        tools,
        maxSteps: 6,
      },
      env: process.env,
      thoughtTitles: { model: { ...model, reasoning: "off" } },
    });
    const chat = await service.createChat("tester");
    const stream = await service.sendMessage("tester", chat.id, {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Сделай игру крестики-нолики в src/game.ts: сначала прочитай README.md, потом напиши код, потом запусти тесты." }],
    });
    for await (const _chunk of stream) void _chunk;

    const answer = (await service.getHistory("tester", chat.id)).messages.at(-1)!;
    const thoughts = answer.parts.filter((part) => part.type === "reasoning");
    const titles = answer.metadata?.thoughtTitles ?? {};
    const [titleUsage] = await storage.sumUsage({ chatId: chat.id, source: "thought_title" });
    const [answerUsage] = await storage.sumUsage({ chatId: chat.id, source: "answer" });

    console.log(`\nраздумий: ${thoughts.length}, заголовков: ${Object.keys(titles).length}`);
    thoughts.forEach((part, index) => {
      const text = (part as { text: string }).text.replace(/\s+/g, " ").trim();
      console.log(`  ${index}: «${titles[String(index)] ?? "— (нет)"}» ← ${text.length} зн.: ${text.slice(0, 140)}…`);
    });
    console.log(`заголовки: вход ${titleUsage?.inputTokens ?? 0} (кэш ${titleUsage?.cachedInputTokens ?? 0}), выход ${titleUsage?.outputTokens ?? 0}, $${(titleUsage?.costUsd ?? 0).toFixed(6)}`);
    console.log(`ответ: вход ${answerUsage?.inputTokens ?? 0}, выход ${answerUsage?.outputTokens ?? 0}, $${(answerUsage?.costUsd ?? 0).toFixed(6)}`);

    expect(thoughts.length).toBeGreaterThan(1);
    expect(Object.keys(titles).length).toBeGreaterThan(0);
    for (const title of Object.values(titles)) {
      expect(fitsLanguage(title, "ru"), title).toBe(true);
      expect(title.split(" ").length, title).toBeLessThanOrEqual(6);
      expect(title).not.toMatch(/[`/_{}]|\.ts\b/);
    }
    expect(titleUsage?.costUsd ?? 0).toBeGreaterThan(0);
  });
});
