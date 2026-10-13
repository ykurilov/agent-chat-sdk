// Живая проверка потолка цены OpenRouter (`maxPrice` → `provider.max_price`): с потолком выше цены модели ход идёт и в
// запросе есть потолок; с потолком ниже любой цены OpenRouter не находит хозяина модели и ход кончается ошибкой.
// Тест платный (один короткий запрос). Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
// Запуск: `pnpm test:live openrouter-max-price`.
import { afterEach, describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import { extendCatalog } from "../../src/models/catalog-changes";
import { createOpenRouterProvider } from "../../src/models/providers/openrouter";
import type { OpenRouterMaxPrice } from "../../src/models/providers/openrouter";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Пишет только поле `provider` тела запроса; ключ не пишется. */
function recordRouting(): unknown[] {
  const routings: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    if (typeof init?.body === "string" && init.body.includes('"messages"')) routings.push((JSON.parse(init.body) as { provider?: unknown }).provider);
    return originalFetch(input, init);
  };
  return routings;
}

async function ask(maxPrice: OpenRouterMaxPrice) {
  const routings = recordRouting();
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: extendCatalog(standardCatalog, { addProviders: [createOpenRouterProvider({ maxPrice })] }),
    defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "openrouter" },
    agent: { instructions: "Отвечай по-русски, одним словом." },
    compaction: false,
    env: process.env,
  });
  const chat = await service.createChat("live");
  const reader = (await service.sendMessage("live", chat.id, { id: "q1", role: "user", parts: [{ type: "text", text: "Столица Франции?" }] })).getReader();
  while (!(await reader.read()).done);
  const answer = (await service.getHistory("live", chat.id)).messages.findLast((message) => message.role === "assistant")!;
  return { answer, routings };
}

describe("OpenRouter: потолок цены", () => {
  it("потолок выше цены — ход идёт, в запросе provider.max_price", async () => {
    const { answer, routings } = await ask({ completionPerMillion: 1.3 });
    console.log(`Маршрут: ${JSON.stringify(routings[0])}; статус ${answer.metadata?.status}`);
    expect(routings[0]).toMatchObject({ max_price: { completion: 1.3 }, sort: "throughput" });
    expect(answer.metadata?.status).toBe("complete");
  }, 90_000);

  it("потолок ниже любой цены — OpenRouter не находит хозяина модели, ход кончается ошибкой", async () => {
    const { answer } = await ask({ completionPerMillion: 0.0001 });
    console.log(`Статус: ${answer.metadata?.status}; ошибка: ${JSON.stringify(answer.metadata?.error ?? null)}`);
    expect(answer.metadata?.status).toBe("error");
  }, 90_000);
});
