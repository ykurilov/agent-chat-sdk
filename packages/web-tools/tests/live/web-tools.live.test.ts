// Живая проверка веб-инструментов: настоящая модель (DeepSeek 4.1 Flash) и настоящий Firecrawl.
// Ключи — только из окружения (`pnpm secrets:load`), в вывод они не попадают.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createFirecrawlServices } from "../../src/firecrawl/firecrawl-services";
import { webToolsInstructions } from "../../src/instructions";
import { createWebTools } from "../../src/create-web-tools";
import { executeOptions } from "../support";

const apiKey = process.env.FIRECRAWL_API_KEY;
if (!apiKey) throw new Error("Нет FIRECRAWL_API_KEY: выполните `pnpm secrets:load`");
if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

const firecrawl = createFirecrawlServices({
  apiKey,
  ...(process.env.FIRECRAWL_BASE_URL && { baseUrl: process.env.FIRECRAWL_BASE_URL }),
});
const webTools = createWebTools(firecrawl);

describe("веб-инструменты у настоящих сервисов", () => {
  it("агент находит свежий факт поиском, читает страницу и отвечает со ссылкой на источник", async () => {
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog: standardCatalog,
      defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
      agent: { instructions: `Ты помощник в тестовом стенде.\n${webToolsInstructions}`, tools: webTools, maxSteps: 8 },
      env: process.env,
    });
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, {
      id: "q1",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Найди в интернете, какая сейчас последняя стабильная версия Node.js. Обязательно прочитай страницу из результатов поиска, прежде чем ответить, и укажи источник ссылкой.",
        },
      ],
    });
    for await (const _chunk of stream) {
      // ход дочитывается до конца
    }

    const { messages } = await service.getHistory("anna", chat.id);
    const answer = messages.findLast((message) => message.role === "assistant");
    const parts = answer?.parts ?? [];
    const calls = parts.filter((part) => part.type.startsWith("tool-"));
    const finished = (name: string) => calls.find((part) => part.type === name && "state" in part && part.state === "output-available");

    const search = finished("tool-web_search") as { output?: unknown } | undefined;
    const read = finished("tool-read_page") as { output?: unknown } | undefined;
    expect(search, "поиск выполнен").toBeDefined();
    expect(read, "страница прочитана").toBeDefined();
    expect(String(search?.output)).toMatch(/^1\. \[.+\]\(https?:\/\/.+\)/);
    expect(String(read?.output)).toMatch(/^# .+\nИсточник: https?:\/\//);

    const text = parts.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(text).toMatch(/\d+\.\d+/);
    expect(text).toMatch(/https?:\/\//);
  });

  it("снимок страницы: служба возвращает ссылку, картинка скачивается и это PNG", async () => {
    const tools = webTools({ profile: { acceptsImages: true, toolResultImageProviders: ["live-screenshot-provider"] }, providerId: "live-screenshot-provider" });
    const shot = tools.page_screenshot;
    if (!shot?.execute || !shot.toModelOutput) throw new Error("инструмента снимка нет");

    const output = await shot.execute({ url: "https://example.com" } as never, executeOptions());
    expect(output).toMatchObject({ pageUrl: "https://example.com/", screenshotUrl: expect.stringMatching(/^https?:\/\//) });
    expect(JSON.stringify(output).length).toBeLessThan(2048);

    const converted = await shot.toModelOutput({ toolCallId: "call-1", input: { url: "https://example.com" }, output });
    expect(converted.type).toBe("content");
    const file = (converted as { value: Array<{ type: string; mediaType?: string; data?: { data: Uint8Array } }> }).value.find(
      (part) => part.type === "file",
    );
    expect(file?.mediaType).toBe("image/png");
    expect(Array.from(file?.data?.data.slice(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
