import { generateText } from "ai";
import { expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import { runCompaction } from "../../../src/compaction/run-compaction";
import { resolveCompactionSettings } from "../../../src/compaction/compaction-settings";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { standardCatalog } from "../../../src/models/standard-catalog";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";

it("реальный DeepSeek serializer: compaction thinking disabled, turn enabled/high; общий messages prefix без гарантии cache hit", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "test", object: "chat.completion", created: 1, model: "deepseek-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "SUMMARY" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 } });
  };
  const model = { modelId: "deepseek-4.1-flash", providerId: "deepseek" };
  const catalog = extendCatalog(standardCatalog, { addModels: [{ ...standardCatalog.models.find(p => p.id === model.modelId)!, reasoning: { replayPastTurns: true, levels: ["off", "high"], defaultLevel: "high" } }] });
  const history: AgentChatMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Question" }] },
    { id: "a1", role: "assistant", parts: [{ type: FROZEN_CONTEXT_PART_TYPE, data: { blocks: [{ key: "profile", text: "APP_WIRE" }], base: null, sent: "all" } }, { type: "text", text: "Answer" }] },
  ];
  const shared = { catalog, env: { DEEPSEEK_API_KEY: "test-key" }, chatId: "test", instructions: "Instruction", history, fetch, logError: () => {} };
  const request = await buildModelRequest({ ...shared, ...model, reasoning: "high", frozenContext: { group: false } });
  await generateText({ model: request.model, instructions: request.instructions, messages: request.messages, providerOptions: request.providerOptions, maxRetries: 0 });
  await runCompaction({ ...shared, model, settings: resolveCompactionSettings({ thresholdTokens: 1_000, tailTokens: 100, summaryCeilingTokens: 100 })! });
  expect(bodies).toHaveLength(2);
  expect(bodies[0]!.thinking).toEqual({ type: "enabled" });
  expect(bodies[0]!.reasoning_effort).toBe("high");
  expect(bodies[1]!.thinking).toEqual({ type: "disabled" });
  expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  expect(JSON.stringify((bodies[1]!.messages as unknown[]).slice(0, -1))).toBe(JSON.stringify(bodies[0]!.messages));
  expect(JSON.stringify(bodies[1]!.messages)).toContain("APP_WIRE");
});
