// Отдельный consumer против настоящего npm-архива, без workspace imports и запросов провайдеру.
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { createChatService, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ContextBlocksRefresh } from "@ykurilov/agent-chat-core";

const mode: ContextBlocksRefresh = "history-start";
const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(c) {
  c.enqueue({ type: "stream-start", warnings: [] });
  c.enqueue({ type: "text-start", id: "t" }); c.enqueue({ type: "text-delta", id: "t", delta: "Готово" }); c.enqueue({ type: "text-end", id: "t" });
  c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } } }); c.close();
} }) }) });
const catalog = extendCatalog(standardCatalog, {
  addProviders: [{ id: "test", displayName: "Test", apiKeyEnv: "TEST_MODEL_TOKEN", createLanguageModel: () => model, requestOptions: () => ({}) }],
  addModels: [{ id: "test-model", displayName: "Test", contextWindowTokens: 100_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { test: "test-model" } }],
});
let reads = 0;
const service = createChatService({
  storage: createInMemoryChatStorage(), catalog, defaultChoice: { modelId: "test-model", providerId: "test" }, env: { TEST_MODEL_TOKEN: "unused-test-value" },
  agent: { instructions: "Помощник", contextBlocksRefresh: mode, contextBlocks: async () => [{ key: "profile", text: `APP_READ_${++reads}` }] },
});
const chat = await service.createChat("anna");
for (const id of ["u1", "u2"]) {
  const stream = await service.sendMessage("anna", chat.id, { id, role: "user", parts: [{ type: "text", text: id }] });
  for await (const _chunk of stream) { /* consume the actual service turn */ }
}
assert.equal(reads, 1);
assert.equal(model.doStreamCalls.length, 2);
const prompt = JSON.stringify(model.doStreamCalls[1]!.prompt);
assert.equal(prompt.split("APP_READ_1").length, 2);
assert.ok(!prompt.includes("APP_READ_2") && !prompt.includes("appContextFrom"));
assert.ok(!JSON.stringify((await service.getHistory("anna", chat.id)).messages).includes("appContextFrom"));
await service.flush();
console.log("PACK CONTEXT REFRESH PASS: exported policy type, NodeNext, real service, one read, stable prompt and hidden metadata");
