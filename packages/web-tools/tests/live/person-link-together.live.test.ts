// Живая проверка: агент на DeepSeek 4.1 Flash через Together смотрит ссылку человека (`person_link_view`) и видит
// снимок страницы. На снимке example.com — ссылка «Learn more» (раньше и заголовок «Example Domain»); текст страницы
// модели не отдаётся, только снимок.
// Ключи — из окружения (`pnpm secrets:load`), в вывод они не попадают.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createFirecrawlServices } from "../../src/firecrawl/firecrawl-services";
import { createPersonLinkTool, PERSON_LINK_TOOL } from "../../src";

const ready = Boolean(process.env.TOGETHER_API_KEY && process.env.FIRECRAWL_API_KEY);

describe.runIf(ready)("просмотр ссылки человека через Together", () => {
  it("DeepSeek 4.1 Flash видит снимок и называет текст на нём", async () => {
    const storage = createInMemoryChatStorage();
    const firecrawl = createFirecrawlServices({ apiKey: process.env.FIRECRAWL_API_KEY! });
    const personLink = createPersonLinkTool({ storage, screenshots: firecrawl.screenshots });
    const service = createChatService({
      storage,
      catalog: standardCatalog,
      defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "together" },
      agent: { instructions: "Ты помощник. Ссылку человека смотри инструментом.", tools: (model) => personLink(model), maxSteps: 4 },
      env: process.env,
    });
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, {
      id: "q1",
      role: "user",
      parts: [{ type: "text", text: "Посмотри мою страницу https://example.com и напиши дословно, по-английски, текст ссылки или заголовка, который на ней виден." }],
    });
    for await (const _chunk of stream) {
      // ход дочитывается до конца
    }
    const { messages } = await service.getHistory("anna", chat.id);
    const parts = messages.findLast((message) => message.role === "assistant")?.parts ?? [];
    const called = parts.some((part) => part.type === `tool-${PERSON_LINK_TOOL}` && "state" in part && part.state === "output-available");
    const text = parts.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(called, "страница просмотрена").toBe(true);
    expect(text).toMatch(/Learn more|Example Domain/i);
  }, 150_000);
});
