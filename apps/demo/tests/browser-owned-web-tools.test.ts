import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createBrowserChatHandler } from "@ykurilov/agent-chat-server";
import { createWebTools } from "@ykurilov/agent-chat-web-tools";
import { createFirecrawlServices } from "@ykurilov/agent-chat-web-tools/firecrawl";
import { catalogWithModel, mockEnv, mockModelId, usage } from "../../../packages/server/tests/support/mock-catalog";

describe("browser-owned handler with the official Firecrawl tools", () => {
  it("searches and reads using request-local tools, then seals both results without a server chat store", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async input => Response.json(String(input).endsWith("/search")
      ? { success: true, data: { web: [{ url: "https://example.com", title: "Synthetic", description: "Search result" }] } }
      : { success: true, data: { markdown: "Read result", metadata: { title: "Synthetic" } } }));
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => {
      const index = step++;
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }, ...(index < 2
        ? [{ type: "tool-call" as const, toolCallId: `call-${index}`, toolName: index === 0 ? "web_search" : "read_page", input: JSON.stringify(index === 0 ? { query: "Synthetic query" } : { url: "https://example.com" }) }]
        : [{ type: "text-start" as const, id: "t" }, { type: "text-delta" as const, id: "t", delta: "Done" }, { type: "text-end" as const, id: "t" }]),
        { type: "finish", finishReason: { unified: index < 2 ? "tool-calls" : "stop", raw: "test" }, usage }];
      return { stream: new ReadableStream({ start(out) { parts.forEach(part => out.enqueue(part)); out.close(); } }) };
    } });
    const handler = createBrowserChatHandler({ namespace: "synthetic-tools", snapshotKey: new Uint8Array(32).fill(4), resolveUser: async () => ({ id: "owner" }), configure: () => {
      const { search, reader } = createFirecrawlServices({ apiKey: "not-a-real-key", fetch });
      return { catalog: catalogWithModel(model), agent: { instructions: "Synthetic", tools: createWebTools({ search, reader }) }, env: mockEnv, defaultChoice: { modelId: mockModelId, providerId: "mock" } };
    } });
    const response = await handler.fetch(new Request("http://test/browser", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: "local", snapshot: null, operation: { type: "message", message: { id: "u1", role: "user", parts: [{ type: "text", text: "Search and read" }] } } }) }));
    expect(response.status).toBe(200); const body = await response.text();
    expect(body).toContain("Search result"); expect(body).toContain("Read result"); expect(body).toContain('"type":"end"');
    expect(fetch).toHaveBeenCalledTimes(2); expect(handler.activeRequests).toBe(0); await handler.close();
  });
});
