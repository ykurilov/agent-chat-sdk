import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import { createChatHandler } from "@ykurilov/agent-chat-server";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createSpendingLimits } from "../src/create-spending-limits";

/** Ход стоит 1 $: 100 токенов входа по 10 000 $ за миллион. Ответ идёт, пока тест его держит. */
function dearSlowCatalog(released: Promise<void>) {
  const usage = {
    inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "ответ" });
          await released;
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          controller.close();
        },
      }),
    }),
  });
  return {
    model,
    catalog: extendCatalog(standardCatalog, {
      addProviders: [{ id: "mock", displayName: "Mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
      addModels: [
        {
          id: "dear-model",
          displayName: "Dear",
          contextWindowTokens: 100_000,
          acceptsImages: false,
          reasoning: { replayPastTurns: true },
          providerModelIds: { mock: "dear-v1" },
          pricing: { mock: { inputPerMillion: 10_000, outputPerMillion: 0 } },
        },
      ],
    }),
  };
}

describe("одновременные ходы и лимит расходов", () => {
  it("20 сообщений разом при бюджете 1,5 $ — идут 3 хода, остальным 429 too_many_turns, потрачено не больше 3 $", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { catalog, model } = dearSlowCatalog(released);
    const storage = createInMemoryChatStorage();
    const limits = createSpendingLimits({ storage, catalog, budget: () => ({ user: 1.5 }), logError: vi.fn() });
    const handler = createChatHandler({
      basePath: "/api/chat",
      storage,
      resolveUser: async () => ({ id: "anna" }),
      defaultChoice: { modelId: "dear-model", providerId: "mock" },
      catalog,
      agent: { instructions: "Ты помощник." },
      compaction: false,
      env: { MOCK_API_KEY: "не-настоящий-ключ" },
      limits,
      logError: vi.fn(),
    });
    const post = (path: string, body?: unknown) =>
      handler.fetch(
        new Request(`http://test.local/api/chat${path}`, {
          method: "POST",
          ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        }),
      );
    const chats = await Promise.all(Array.from({ length: 20 }, async () => ((await (await post("")).json()) as { id: string }).id));
    const responses = await Promise.all(
      chats.map((chatId, index) => post(`/${chatId}/messages`, { message: { id: `u${index}`, role: "user", parts: [{ type: "text", text: "привет" }] } })),
    );

    const refused = responses.filter((response) => response.status === 429);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(3);
    expect(refused).toHaveLength(17);
    for (const response of refused) expect(await response.json()).toEqual({ error: { kind: "too_many_turns", limit: 3 } });

    release();
    await Promise.all(responses.filter((response) => response.status === 200).map((response) => response.text()));
    expect(model.doStreamCalls).toHaveLength(3);
    expect((await limits.getSpending({ userId: "anna" })).user.spentUsd).toBeLessThanOrEqual(3);
  });
});
