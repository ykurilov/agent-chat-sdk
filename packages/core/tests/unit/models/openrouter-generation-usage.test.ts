import { describe, expect, it } from "vitest";
import { createOpenRouterProvider, openrouterProvider } from "../../../src/models/providers/openrouter";

const generationUsage = openrouterProvider.generationUsage!;

/** `fetch`, который отвечает по очереди заданными ответами и запоминает адреса и заголовки. */
function scriptedFetch(responses: Response[]) {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    const next = responses.shift();
    if (!next) throw new Error("лишний запрос");
    return next;
  };
  return { fetch, requests };
}

describe("OpenRouter: настоящий расход генерации по номеру (FR-058)", () => {
  it("номер генерации — из заголовка ответа x-generation-id", () => {
    expect(generationUsage.generationId({ "x-generation-id": "gen-123", "content-type": "text/event-stream" })).toBe("gen-123");
    expect(generationUsage.generationId({ "content-type": "text/event-stream" })).toBeUndefined();
    expect(generationUsage.generationId(undefined)).toBeUndefined();
  });

  it("расход — из native_tokens_*: вход с кэшем, выход с рассуждениями; запрос с ключом и номером", async () => {
    const body = {
      data: {
        id: "gen-1",
        cancelled: false,
        native_tokens_prompt: 1200,
        native_tokens_cached: 800,
        native_tokens_completion: 97,
        native_tokens_reasoning: 40,
        total_cost: 0.00038175,
      },
    };
    const { fetch, requests } = scriptedFetch([Response.json(body)]);

    const usage = await generationUsage.lookup({ generationId: "gen-1", apiKey: "k-test", fetch });

    expect(usage).toEqual({ inputTokens: 1200, cachedInputTokens: 800, outputTokens: 97, reasoningTokens: 40 });
    expect(requests).toEqual([{ url: "https://openrouter.ai/api/v1/generation?id=gen-1", authorization: "Bearer k-test" }]);
  });

  it("OpenRouter ещё не знает генерацию (404) — `null`: спросят позже", async () => {
    const { fetch } = scriptedFetch([new Response('{"error":{"message":"Generation not found"}}', { status: 404 })]);
    expect(await generationUsage.lookup({ generationId: "gen-2", apiKey: "k", fetch })).toBeNull();
  });

  it("запись без чисел (native_tokens_* = null) — `null`, а не нули: спросят позже", async () => {
    const empty = { data: { id: "gen-4", native_tokens_prompt: null, native_tokens_cached: null, native_tokens_completion: null, native_tokens_reasoning: null } };
    const { fetch } = scriptedFetch([Response.json(empty)]);
    expect(await generationUsage.lookup({ generationId: "gen-4", apiKey: "k", fetch })).toBeNull();
  });

  it("другой отказ — ошибка", async () => {
    const { fetch } = scriptedFetch([new Response("boom", { status: 500 })]);
    await expect(generationUsage.lookup({ generationId: "gen-3", apiKey: "k", fetch })).rejects.toThrow(/500/);
  });

  it("свой OpenRouter (правила хранения данных) умеет то же", () => {
    expect(createOpenRouterProvider({ dataCollection: "deny" }).generationUsage).toBe(generationUsage);
  });
});
