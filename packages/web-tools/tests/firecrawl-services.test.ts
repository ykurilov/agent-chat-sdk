import { describe, expect, it, vi } from "vitest";
import { createFirecrawlServices } from "../src/firecrawl/firecrawl-services";
import { WebToolError } from "../src/web-tool-error";
import type { WebToolErrorKind } from "../src/web-tool-error";

const apiKey = "fc-secret-key-123";
const proxyHost = "proxy.secret-host.example";
const proxyToken = "tok-999-secret";

interface Recorded {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(respond: (request: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const recorded: Recorded = {
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init?.signal,
    };
    calls.push(recorded);
    return respond(recorded);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("поиск", () => {
  it("POST /v2/search с запросом и числом результатов, ключ в заголовке авторизации", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse({ success: true, data: { web: [{ url: "https://nodejs.org/r", title: "Node.js Releases", description: "Текущая версия 26" }] } }),
    );
    const { search } = createFirecrawlServices({ apiKey, fetch });
    const hits = await search.search("версия node", { limit: 4 });

    expect(hits).toEqual([{ title: "Node.js Releases", url: "https://nodejs.org/r", snippet: "Текущая версия 26" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.firecrawl.dev/v2/search", method: "POST", body: { query: "версия node", limit: 4 } });
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${apiKey}`);
    expect(calls[0]?.headers["content-type"]).toContain("application/json");
  });

  it("выдержка очищается от разметки и режется до 300 знаков", async () => {
    const description = `# [Node.js Releases](https://nodejs.org/r#a)\n## Заголовок\n| Node | Статус |\n|-|-|\n| **v26** | \`Current\` |\n${"слово ".repeat(100)}`;
    const { fetch } = fakeFetch(() => jsonResponse({ success: true, data: { web: [{ url: "https://nodejs.org/r", title: "T", description }] } }));
    const [hit] = await createFirecrawlServices({ apiKey, fetch }).search.search("q", { limit: 1 });

    expect(hit?.snippet).not.toMatch(/[\n|*`#\]]|\]\(/);
    expect(hit?.snippet.startsWith("Node.js Releases Заголовок Node Статус v26 Current")).toBe(true);
    expect(hit?.snippet.length).toBeLessThanOrEqual(301);
    expect(hit?.snippet.endsWith("…")).toBe(true);
  });

  it("результаты без адреса отбрасываются, нет описания — пустая выдержка", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ success: true, data: { web: [{ title: "без адреса" }, { url: "https://a.example", title: "A" }] } }),
    );
    const hits = await createFirecrawlServices({ apiKey, fetch }).search.search("q", { limit: 5 });
    expect(hits).toEqual([{ title: "A", url: "https://a.example", snippet: "" }]);
  });

  it("адреса не http и не https отбрасываются", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({
        success: true,
        data: {
          web: [
            { url: "javascript:alert(1)", title: "A" },
            { url: "file:///etc/passwd", title: "B" },
            { url: "data:text/html,x", title: "C" },
            { url: "https://ok.example", title: "D" },
          ],
        },
      }),
    );
    const hits = await createFirecrawlServices({ apiKey, fetch }).search.search("q", { limit: 5 });
    expect(hits.map((hit) => hit.url)).toEqual(["https://ok.example"]);
  });

  it("сервис ничего не нашёл — пустой список", async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ success: true, data: {} }));
    expect(await createFirecrawlServices({ apiKey, fetch }).search.search("q", { limit: 5 })).toEqual([]);
  });
});

describe("чтение", () => {
  it("POST /v2/scrape за markdown основного содержимого", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse({
        success: true,
        data: { markdown: "Текст", metadata: { title: "Пример", sourceURL: "https://example.com/a" } },
      }),
    );
    const page = await createFirecrawlServices({ apiKey, fetch }).reader.readPage("https://example.com/a", {});

    expect(page).toEqual({ url: "https://example.com/a", title: "Пример", markdown: "Текст" });
    expect(calls[0]).toMatchObject({
      url: "https://api.firecrawl.dev/v2/scrape",
      body: { url: "https://example.com/a", formats: ["markdown"], onlyMainContent: true },
    });
  });

  it("адрес страницы в ответе не http — берётся запрошенный", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ success: true, data: { markdown: "Текст", metadata: { url: "javascript:alert(1)", sourceURL: "file:///x" } } }),
    );
    const page = await createFirecrawlServices({ apiKey, fetch }).reader.readPage("https://example.com/a", {});
    expect(page.url).toBe("https://example.com/a");
  });

  it("нет заголовка и sourceURL — берутся пустой заголовок и запрошенный адрес", async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ success: true, data: { markdown: "Текст" } }));
    const page = await createFirecrawlServices({ apiKey, fetch }).reader.readPage("https://example.com/a", {});
    expect(page).toEqual({ url: "https://example.com/a", title: "", markdown: "Текст" });
  });
});

describe("снимок", () => {
  it("POST /v2/scrape за снимком, возвращает адрес картинки", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ success: true, data: { screenshot: "https://storage.example/shot.png?sig=1" } }));
    const shot = await createFirecrawlServices({ apiKey, fetch }).screenshots.takeScreenshot("https://example.com", {});

    expect(shot).toEqual({ imageUrl: "https://storage.example/shot.png?sig=1" });
    expect(calls[0]).toMatchObject({ url: "https://api.firecrawl.dev/v2/scrape", body: { url: "https://example.com", formats: ["markdown", "screenshot"] } });
  });

  it("тем же запросом (1 кредит) — текст страницы: он нужен модели, которой картинка не дойдёт", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ success: true, data: { screenshot: "https://storage.example/shot.png", markdown: "Маникюр", metadata: { title: "Студия", sourceURL: "https://example.com/" } } }),
    );
    const shot = await createFirecrawlServices({ apiKey, fetch }).screenshots.takeScreenshot("https://example.com", {});
    expect(shot).toEqual({ imageUrl: "https://storage.example/shot.png", page: { url: "https://example.com/", title: "Студия", markdown: "Маникюр" } });
  });

  it.each(["javascript:alert(1)", "file:///etc/passwd", "data:image/png;base64,AAAA"])("адрес снимка %s — неожиданный ответ", async (screenshot) => {
    const { fetch } = fakeFetch(() => jsonResponse({ success: true, data: { screenshot } }));
    await expect(createFirecrawlServices({ apiKey, fetch }).screenshots.takeScreenshot("https://example.com", {})).rejects.toMatchObject({
      kind: "bad_response",
    });
  });

  it("в ответе нет снимка — неожиданный ответ", async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ success: true, data: {} }));
    await expect(createFirecrawlServices({ apiKey, fetch }).screenshots.takeScreenshot("https://example.com", {})).rejects.toMatchObject({
      kind: "bad_response",
    });
  });
});

describe("прокси", () => {
  it("запросы идут на baseUrl (с путём и слэшем на конце) с дополнительными заголовками; ключ остаётся", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ success: true, data: { web: [] } }));
    const { search } = createFirecrawlServices({
      apiKey,
      baseUrl: `https://${proxyHost}/firecrawl/`,
      headers: { "X-Proxy-Token": proxyToken },
      fetch,
    });
    await search.search("q", { limit: 1 });

    expect(calls[0]?.url).toBe(`https://${proxyHost}/firecrawl/v2/search`);
    expect(calls[0]?.headers["x-proxy-token"]).toBe(proxyToken);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${apiKey}`);
  });
});

describe("ошибки не выдают секретов", () => {
  const options = { apiKey, baseUrl: `https://${proxyHost}/firecrawl`, headers: { "X-Proxy-Token": proxyToken } };

  async function failureOf(respond: () => Response | Promise<Response>, extra: object = {}) {
    const { fetch } = fakeFetch(respond);
    const { search } = createFirecrawlServices({ ...options, fetch, ...extra });
    return search.search("q", { limit: 1 }).then(
      () => {
        throw new Error("ожидалась ошибка");
      },
      (error: unknown) => error,
    );
  }

  it.each<[string, () => Response, WebToolErrorKind]>([
    ["401", () => jsonResponse({ error: `Unauthorized ${apiKey}` }, 401), "invalid_key"],
    ["403", () => jsonResponse({ error: "Forbidden" }, 403), "invalid_key"],
    ["402", () => jsonResponse({ error: "Payment required" }, 402), "insufficient_funds"],
    ["429", () => jsonResponse({ error: "Too many" }, 429), "rate_limited"],
    ["500", () => new Response(`Internal ${proxyHost} ${proxyToken}`, { status: 500 }), "unavailable"],
    ["502", () => new Response("Bad gateway", { status: 502 }), "unavailable"],
    ["не JSON", () => new Response("<html>oops</html>", { status: 200 }), "bad_response"],
    ["success: false", () => jsonResponse({ success: false, error: `bad ${apiKey}` }), "bad_response"],
    ["нет data", () => jsonResponse({ success: true }), "bad_response"],
  ])("ответ %s", async (_name, respond, kind) => {
    const error = await failureOf(respond);
    expect(error).toBeInstanceOf(WebToolError);
    expect((error as WebToolError).kind).toBe(kind);
    const text = `${(error as Error).message} ${String((error as Error).cause ?? "")}`;
    expect(text).not.toContain(apiKey);
    expect(text).not.toContain(proxyHost);
    expect(text).not.toContain(proxyToken);
    expect((error as Error).message.length).toBeGreaterThan(10);
  });

  it("обрыв сети", async () => {
    const error = await failureOf(() => {
      throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${proxyHost}`);
    });
    expect((error as WebToolError).kind).toBe("unavailable");
    expect((error as Error).message).not.toContain(proxyHost);
    expect(String((error as Error).cause ?? "")).not.toContain(proxyHost);
  });

  it("тайм-аут запроса", async () => {
    const error = await failureOf(
      () => new Promise<Response>(() => {}),
      { timeoutMs: 20 },
    );
    expect((error as WebToolError).kind).toBe("timeout");
  });

  it("остановка хода прерывает запрос и отдаёт ошибку остановки, а не ошибку службы", async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch(
      ({ signal }) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const pending = createFirecrawlServices({ ...options, fetch }).search.search("q", { limit: 1, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toSatisfy((error: unknown) => !(error instanceof WebToolError));
  });
});
