import type { Plugin } from "vite";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createChatServer } from "@ykurilov/agent-chat-server";
import { toNodeListener } from "@ykurilov/agent-chat-server/node";
import { createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";

/** Real SDK server/storage and a gated synthetic model; client disconnection must not cancel its turn. */
export function pageGenerationFixturePlugin(): Plugin {
  const jobs: Array<{ finished: boolean; aborted: boolean; release: () => void }> = [];
  let stopCalls = 0;
  const delayedAcknowledgements = new Set<string>();
  const model = new MockLanguageModelV4({ doStream: async input => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const job = { finished: false, aborted: false, release };
    jobs.push(job);
    return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(out) {
      out.enqueue({ type: "stream-start", warnings: [] });
      out.enqueue({ type: "text-start", id: "t" });
      out.enqueue({ type: "text-delta", id: "t", delta: "Начало " });
      void gate.then(() => {
        if (job.aborted) return;
        job.finished = true;
        out.enqueue({ type: "text-delta", id: "t", delta: "и конец." });
        out.enqueue({ type: "text-end", id: "t" });
        out.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } });
        out.close();
      });
      input.abortSignal?.addEventListener("abort", () => {
        if (job.finished) return;
        job.aborted = true;
        try { out.error(new DOMException("Aborted", "AbortError")); } catch {}
      }, { once: true });
    } }) };
  } });
  const catalog = extendCatalog(standardCatalog, {
    addProviders: [{ id: "mock", displayName: "Тест", apiKeyEnv: "MOCK_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
    addModels: [{ id: "generation-test", displayName: "Тест", contextWindowTokens: 1_000_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { mock: "generation-test" } }],
  });
  const { handler, service } = createChatServer({ basePath: "/page-generation", storage: createInMemoryChatStorage(), resolveUser: async () => ({ id: "fixture-owner" }),
    catalog, defaultChoice: { modelId: "generation-test", providerId: "mock" }, env: { MOCK_KEY: "not-a-real-key" }, agent: { instructions: "Synthetic fixture" }, compaction: false });
  const listener = toNodeListener({ basePath: handler.basePath, fetch: async request => {
    const response = await handler.fetch(request);
    const chatId = new URL(request.url).pathname.match(/^\/page-generation\/([^/]+)\/messages$/)?.[1];
    // The real handler has already accepted the question and started generation.
    // Hold only its HTTP acknowledgement; releasing on disconnect must not stop the turn.
    if (request.method === "POST" && chatId && delayedAcknowledgements.delete(chatId)) {
      await new Promise<void>(resolve => {
        if (request.signal.aborted) return resolve();
        const done = () => { clearTimeout(timer); request.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 15000);
        request.signal.addEventListener("abort", done, { once: true });
      });
    }
    return response;
  } });
  return { name: "page-generation-fixture", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith("/page-generation-fixture/")) {
        if (req.url.startsWith("/page-generation-fixture/finish")) jobs.at(-1)?.release();
        const chatId = new URL(req.url, "http://fixture").searchParams.get("chat");
        void (async () => {
          if (chatId && req.url?.startsWith("/page-generation-fixture/hold-ack")) delayedAcknowledgements.add(chatId);
          const history = chatId ? await service.getHistory("fixture-owner", chatId) : undefined;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ jobs: jobs.map(({ finished, aborted }) => ({ finished, aborted })), stopCalls, history }));
        })().catch(next);
        return;
      }
      if (req.url?.startsWith("/page-generation/") && req.url.endsWith("/stop")) stopCalls++;
      listener(req, res, next);
    });
    server.httpServer?.once("close", () => { for (const job of jobs) job.release(); });
  } };
}
