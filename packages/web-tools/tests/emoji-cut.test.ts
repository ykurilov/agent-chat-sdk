import { describe, expect, it } from "vitest";
import { createFirecrawlServices } from "../src/firecrawl/firecrawl-services";
import { formatPage } from "../src/result-text";

const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("обрезка не рвёт эмодзи (FR-036)", () => {
  it("страница: эмодзи ровно на границе предела", () => {
    const markdown = `${"x".repeat(99)}😀${"y".repeat(50)}`;
    const text = formatPage({ title: "T", url: "https://a.example", markdown }, 100);
    expect(text).not.toMatch(loneSurrogate);
    expect(text).toContain("[Текст обрезан:");
  });

  it("выдержка поиска: эмодзи ровно на границе 300 знаков", async () => {
    const description = `${"a".repeat(299)}😀bbb`;
    const fetch = async () =>
      new Response(JSON.stringify({ success: true, data: { web: [{ url: "https://a.example", title: "T", description }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const [hit] = await createFirecrawlServices({ apiKey: "fc-key", fetch: fetch as typeof globalThis.fetch }).search.search("q", { limit: 1 });
    expect(hit?.snippet).not.toMatch(loneSurrogate);
    expect(hit?.snippet.endsWith("…")).toBe(true);
  });
});
