import type { Plugin } from "vite";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createBrowserChatHandler } from "@ykurilov/agent-chat-server";
import { toNodeListener } from "@ykurilov/agent-chat-server/node";
import { extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
/** Synthetic, no credentials/network model calls or ordinary chat storage. */
export function browserChatFixturePlugin(): Plugin {
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async input => {
    const call = ++calls;
    return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(out) {
      out.enqueue({ type: "stream-start", warnings: [] }); out.enqueue({ type: "text-start", id: "t" });
      out.enqueue({ type: "text-delta", id: "t", delta: `Ответ ${call}: сохранённый префикс. ` });
      const timer = setTimeout(() => { out.enqueue({ type: "text-delta", id: "t", delta: "Готово." }); out.enqueue({ type: "text-end", id: "t" }); out.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } }); out.close(); }, 3000);
      input.abortSignal?.addEventListener("abort", () => { clearTimeout(timer); try { out.error(new DOMException("Aborted", "AbortError")); } catch {} }, { once: true });
    } }) };
  } });
  const catalog = extendCatalog(standardCatalog, { addProviders: [{ id: "mock", displayName: "Тест", apiKeyEnv: "MOCK_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }], addModels: Array.from({ length: 11 }, (_, i) => ({ id: `browser-${i}`, displayName: `Модель ${i + 1}`, contextWindowTokens: 1_000_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { mock: `browser-${i}` } })) });
  const handler = createBrowserChatHandler({ namespace: "synthetic-browser-gallery", snapshotKey: new Uint8Array(32).fill(3), resolveUser: async () => ({ id: "fixture-owner" }), configure: () => ({ catalog, agent: { instructions: "Synthetic fixture" }, env: { MOCK_KEY: "not-a-real-key" }, defaultChoice: { modelId: "browser-0", providerId: "mock" } }) });
  return { name: "browser-chat-fixture", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === "/browser-chat-fixture/stats") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ calls, active: handler.activeRequests })); return; }
      toNodeListener({ basePath: "/browser-chat-fixture", fetch: handler.fetch })(req, res, next);
    });
    server.httpServer?.once("close", () => { void handler.close(); });
  } };
}
