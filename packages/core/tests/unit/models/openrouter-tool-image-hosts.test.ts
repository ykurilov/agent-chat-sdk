import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatService } from "../../../src/chat-service";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { createOpenRouterProvider } from "../../../src/models/providers/openrouter";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";

function sse(text: string): Response {
  const chunk = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", provider: "p" };
  const lines = [
    { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: text } }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Маршруты (`provider`) двух ходов подряд в одном чате. */
async function routingOfTwoTurns(modelId: string, provider = createOpenRouterProvider()): Promise<unknown[]> {
  const routes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    routes.push(JSON.parse(String(init?.body)).provider);
    return sse("Ответ");
  }));
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: extendCatalog(standardCatalog, { addProviders: [provider] }),
    defaultChoice: { modelId, providerId: "openrouter" },
    agent: { instructions: "Ты помощник." },
    env: { OPENROUTER_API_KEY: "test-key" },
  });
  const chat = await service.createChat("owner");
  for (const id of ["u1", "u2"]) {
    const stream = await service.sendMessage("owner", chat.id, { id, role: "user", parts: [{ type: "text", text: "Привет" }] });
    const reader = stream.getReader();
    while (!(await reader.read()).done) {
      // ход дочитывается до конца
    }
  }
  return routes;
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter: запрет хозяев, которые не видят картинку в результате инструмента", () => {
  it("запрет из профиля модели сливается с потолком цены и сортировкой приложения и одинаков в каждом ходе (кэш)", async () => {
    const routes = await routingOfTwoTurns("deepseek-4.1-flash", createOpenRouterProvider({ maxPrice: { completionPerMillion: 1.3 } }));
    expect(routes[0]).toEqual({
      sort: "throughput",
      max_price: { completion: 1.3 },
      ignore: ["deepinfra", "open-inference", "phala", "sail-research", "venice"],
    });
    expect(routes[1]).toEqual(routes[0]);
  });

  it("свой запрет приложения объединяется с запретом модели", async () => {
    const [route] = await routingOfTwoTurns("gemini-3.8-flash", createOpenRouterProvider({ ignore: ["azure"], sort: "price" }));
    expect(route).toEqual({ sort: "price", ignore: ["azure", "google-vertex"] });
  });

  it("у модели без запрета маршрут прежний", async () => {
    const [route] = await routingOfTwoTurns("gpt-6-luna");
    expect(route).toEqual({ sort: "throughput" });
  });
});
