import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { WEB_TOOL_NAMES } from "@ykurilov/agent-chat-core";
import { createWebTools } from "../src/create-web-tools";
import type { PageReaderService, WebSearchService } from "../src/services";
import { WebToolError } from "../src/web-tool-error";
import { executeOptions, noImages, samplePage, sampleHits } from "./support";

function services() {
  const search = { search: vi.fn<WebSearchService["search"]>(async () => sampleHits) };
  const reader = { readPage: vi.fn<PageReaderService["readPage"]>(async () => samplePage) };
  return { search, reader };
}

async function execute(tools: ToolSet, name: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  const run = tools[name]?.execute;
  if (!run) throw new Error(`инструмента ${name} нет`);
  return run(input as never, executeOptions(signal));
}

async function definitions(tools: ToolSet) {
  return Promise.all(
    Object.entries(tools).map(async ([name, item]) => [name, item.description, await asSchema(item.inputSchema).jsonSchema] as const),
  );
}

describe("createWebTools: состав набора", () => {
  it("поиск и чтение есть всегда", () => {
    const tools = createWebTools(services())(noImages);
    expect(Object.keys(tools).sort()).toEqual(["read_page", "web_search"]);
  });

  it("имена инструментов известны ядру: старые вызовы без пометки тоже считаются чужим текстом", () => {
    const tools = createWebTools({ ...services(), screenshots: { screenshot: vi.fn() } } as never)({ profile: { acceptsImages: true, toolResultImageProviders: ["openai"] }, providerId: "openai" } as never);
    expect(Object.keys(tools).sort()).toEqual([...WEB_TOOL_NAMES].sort());
  });
});

describe("createWebTools: постоянные описания (кэш модели)", () => {
  it("описания и схемы входа не зависят от настроек приложения", async () => {
    const first = createWebTools({ ...services(), searchResultLimit: 3, pageCharacterLimit: 1000 })(noImages);
    const second = createWebTools({ ...services(), searchResultLimit: 20, pageCharacterLimit: 90_000 })(noImages);
    expect(await definitions(first)).toEqual(await definitions(second));
  });

  it("замена службы поиска своей не меняет описаний", async () => {
    const own: WebSearchService = { search: async () => [] };
    const before = await definitions(createWebTools(services())(noImages));
    const after = await definitions(createWebTools({ ...services(), search: own })(noImages));
    expect(after).toEqual(before);
  });

  it("описания без дат и чисел из настроек; вход — одна строка на инструмент", async () => {
    const defs = await definitions(createWebTools(services())(noImages));
    for (const [, description, schema] of defs) {
      expect(description).toBeTruthy();
      expect(description).not.toMatch(/20\d\d/);
      expect(Object.keys((schema as { properties: object }).properties)).toHaveLength(1);
    }
    expect(Object.fromEntries(defs.map(([name, , schema]) => [name, Object.keys((schema as { properties: object }).properties)]))).toEqual({
      read_page: ["url"],
      web_search: ["query"],
    });
  });
});

describe("web_search", () => {
  it("зовёт службу с запросом и числом результатов и возвращает Markdown-строку", async () => {
    const parts = services();
    const tools = createWebTools({ ...parts, searchResultLimit: 7 })(noImages);
    const result = await execute(tools, "web_search", { query: "версия node" });

    expect(parts.search.search).toHaveBeenCalledWith("версия node", expect.objectContaining({ limit: 7 }));
    expect(result).toBe("1. [Node.js Releases](https://nodejs.org/releases)\n   Текущая версия 26");
  });

  it("по умолчанию — пять результатов", async () => {
    const parts = services();
    await execute(createWebTools(parts)(noImages), "web_search", { query: "q" });
    expect(parts.search.search).toHaveBeenCalledWith("q", expect.objectContaining({ limit: 5 }));
  });

  it("пустой запрос — понятная ошибка, служба не вызывается", async () => {
    const parts = services();
    await expect(execute(createWebTools(parts)(noImages), "web_search", { query: "   " })).rejects.toThrowError(WebToolError);
    expect(parts.search.search).not.toHaveBeenCalled();
  });

  it("передаёт службе сигнал остановки хода", async () => {
    const parts = services();
    const controller = new AbortController();
    await execute(createWebTools(parts)(noImages), "web_search", { query: "q" }, controller.signal);
    expect(parts.search.search.mock.calls[0]?.[1].signal).toBe(controller.signal);
  });
});

describe("read_page", () => {
  it("читает страницу и возвращает заголовок, источник и текст", async () => {
    const parts = services();
    const result = await execute(createWebTools(parts)(noImages), "read_page", { url: "https://nodejs.org/releases" });

    expect(parts.reader.readPage).toHaveBeenCalledWith("https://nodejs.org/releases", expect.anything());
    expect(result).toBe("# Node.js Releases\nИсточник: https://nodejs.org/releases\n\nТекущая: 26.");
  });

  it("режет длинную страницу по пределу приложения", async () => {
    const parts = services();
    parts.reader.readPage.mockResolvedValue({ ...samplePage, markdown: "z".repeat(500) });
    const result = await execute(createWebTools({ ...parts, pageCharacterLimit: 100 })(noImages), "read_page", { url: "https://a.example" });
    expect(result).toContain("[Текст обрезан: показано 100 из 500 знаков]");
  });

  it.each(["http://localhost:3000", "http://192.168.0.1/admin", "ftp://example.com", "не адрес"])(
    "адрес %s отклоняется до обращения к службе",
    async (url) => {
      const parts = services();
      await expect(execute(createWebTools(parts)(noImages), "read_page", { url })).rejects.toThrowError(WebToolError);
      expect(parts.reader.readPage).not.toHaveBeenCalled();
    },
  );
});

describe("ошибки службы", () => {
  it("WebToolError службы доходит до модели и человека своим текстом", async () => {
    const parts = services();
    parts.search.search.mockRejectedValue(new WebToolError("rate_limited", "Превышен лимит запросов сервиса веб-инструментов, попробуйте позже."));
    await expect(execute(createWebTools(parts)(noImages), "web_search", { query: "q" })).rejects.toThrowError(
      "Превышен лимит запросов сервиса веб-инструментов, попробуйте позже.",
    );
  });

  it("чужая ошибка службы (например, своей реализации) не выдаёт подробностей: они могут содержать ключ или адрес", async () => {
    const parts = services();
    parts.reader.readPage.mockRejectedValue(new Error("connect ECONNREFUSED https://proxy.secret.example?key=sk-123"));
    const failure = execute(createWebTools(parts)(noImages), "read_page", { url: "https://a.example" });
    await expect(failure).rejects.toThrowError(WebToolError);
    await expect(failure).rejects.not.toThrowError(/secret|sk-123/);
  });

  it("остановка хода не превращается в ошибку службы", async () => {
    const parts = services();
    const abort = new DOMException("The operation was aborted", "AbortError");
    parts.reader.readPage.mockRejectedValue(abort);
    await expect(execute(createWebTools(parts)(noImages), "read_page", { url: "https://a.example" })).rejects.toBe(abort);
  });
});
