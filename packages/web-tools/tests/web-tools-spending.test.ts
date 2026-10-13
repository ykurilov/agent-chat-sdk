import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createWebTools } from "../src/create-web-tools";
import type { CreateWebToolsOptions } from "../src/create-web-tools";
import type { PageReaderService, WebSearchService } from "../src/services";
import { serviceFailure } from "../src/web-tool-error";
import { executeOptions, samplePage, sampleHits } from "./support";

const turn = { profile: { acceptsImages: false }, providerId: "deepseek", ownerId: "anna", chatId: "chat-1" };

function setup(spending: Partial<NonNullable<CreateWebToolsOptions["spending"]>> = {}) {
  const storage = createInMemoryChatStorage();
  const logError = vi.fn();
  const search = { search: vi.fn<WebSearchService["search"]>(async () => sampleHits) };
  const reader = { readPage: vi.fn<PageReaderService["readPage"]>(async () => samplePage) };
  const webTools = createWebTools({
    search,
    reader,
    spending: { storage, pricePerCallUsd: { web_search: 0.004, read_page: 0.002 }, logError, now: () => Date.parse("2026-10-02T10:00:00Z"), ...spending },
  });
  return { storage, logError, search, reader, webTools };
}

async function execute(tools: ToolSet, name: string, input: unknown): Promise<unknown> {
  return tools[name]!.execute!(input as never, executeOptions());
}

async function definitions(tools: ToolSet) {
  return Promise.all(Object.entries(tools).map(async ([name, item]) => [name, item.description, await asSchema(item.inputSchema).jsonSchema] as const));
}

describe("createWebTools: траты веб-служб идут в лимит расходов", () => {
  it("удачный поиск и чтение страницы записываются расходом человека в этом чате", async () => {
    const { storage, webTools } = setup();
    const tools = webTools(turn);
    await execute(tools, "web_search", { query: "версия node" });
    await execute(tools, "read_page", { url: "https://nodejs.org/releases" });

    const sums = await storage.sumUsage({ ownerId: "anna", chatId: "chat-1" });
    expect(sums.reduce((total, sum) => total + sum.costUsd, 0)).toBeCloseTo(0.006);
    expect(sums.every((sum) => sum.providerId === "firecrawl")).toBe(true);
  });

  it("запись расхода: источник web_tools, служба firecrawl, имя инструмента вместо модели", async () => {
    const insert = vi.fn(async () => undefined);
    const { webTools } = setup({ storage: { insertUsageRecord: insert } });
    await execute(webTools(turn), "web_search", { query: "q" });
    expect(insert).toHaveBeenCalledWith({
      id: expect.any(String),
      ownerId: "anna",
      chatId: "chat-1",
      messageId: null,
      source: "web_tools",
      modelId: "web_search",
      providerId: "firecrawl",
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.004,
      createdAt: "2026-10-02T10:00:00.000Z",
    });
  });

  it("отказ до работы службы (неверный адрес, пустой запрос, ключ, деньги, частота) не записывается", async () => {
    const { storage, search, webTools } = setup();
    const tools = webTools(turn);
    await expect(execute(tools, "read_page", { url: "http://127.0.0.1/" })).rejects.toThrow();
    await expect(execute(tools, "web_search", { query: "  " })).rejects.toThrow();
    for (const kind of ["invalid_key", "insufficient_funds", "rate_limited"] as const) {
      search.search.mockRejectedValueOnce(serviceFailure(kind));
      await expect(execute(tools, "web_search", { query: "q" })).rejects.toThrow();
    }
    expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);
  });

  it("сбой после отправки запроса (срок, неожиданный ответ, служба недоступна) записывается: служба могла списать", async () => {
    const { storage, search, webTools } = setup();
    const tools = webTools(turn);
    search.search.mockRejectedValueOnce(serviceFailure("timeout"));
    search.search.mockRejectedValueOnce(serviceFailure("bad_response"));
    search.search.mockRejectedValueOnce(new Error("сбой"));
    for (let call = 0; call < 3; call += 1) await expect(execute(tools, "web_search", { query: "q" })).rejects.toThrow();
    const [sum] = await storage.sumUsage({ ownerId: "anna" });
    expect(sum?.costUsd).toBeCloseTo(3 * 0.004);
  });

  it("«Стоп» посреди вызова записывается; ход, остановленный до вызова, — нет", async () => {
    const { storage, search, webTools } = setup();
    const tools = webTools(turn);
    const stop = new AbortController();
    search.search.mockImplementationOnce(
      (_query, options) =>
        new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal!.reason))),
    );
    const call = tools.web_search!.execute!({ query: "q" } as never, executeOptions(stop.signal));
    stop.abort(new DOMException("Остановлено", "AbortError"));
    await expect(call).rejects.toThrow();
    // Служба со сработавшим сигналом запрос не отправляет.
    search.search.mockImplementationOnce(async (_query, options) => Promise.reject(options?.signal?.reason));
    await expect(tools.web_search!.execute!({ query: "q" } as never, executeOptions(stop.signal))).rejects.toThrow();
    const [sum] = await storage.sumUsage({ ownerId: "anna" });
    expect(sum?.costUsd).toBeCloseTo(0.004);
  });

  it("сбой записи расхода уходит в журнал, ответ инструмента не теряется", async () => {
    const { logError, webTools } = setup({ storage: { insertUsageRecord: async () => Promise.reject(new Error("диск полон")) } });
    expect(await execute(webTools(turn), "web_search", { query: "q" })).toContain("Node.js Releases");
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/диск полон/));
  });

  it("описания и схемы те же, что без учёта трат: кэш модели не сбрасывается", async () => {
    const { webTools, search, reader } = setup();
    const plain = createWebTools({ search, reader })(turn);
    expect(await definitions(webTools(turn))).toEqual(await definitions(plain));
  });

  it("неверная цена — ошибка при создании", () => {
    for (const price of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => setup({ pricePerCallUsd: { web_search: price, read_page: 0 } })).toThrow(/pricePerCallUsd/);
    }
  });
});
