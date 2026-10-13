import { tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { readAll } from "../support/mock-model";
import { startTurn, storageWithQuestion } from "../support/turn-fixtures";

type Body = { messages: unknown[] };

/** Ответ DeepSeek потоком (как у OpenAI): вызов инструмента или текст. */
function deepSeekStream(delta: Record<string, unknown>, finishReason: string): Response {
  const chunk = { id: "c-1", object: "chat.completion.chunk", created: 1, model: "deepseek-flash" };
  const lines = [
    { ...chunk, choices: [{ index: 0, delta: { role: "assistant", ...delta } }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const toolCall = (id: string) => deepSeekStream({ tool_calls: [{ index: 0, id, type: "function", function: { name: "lookup", arguments: "{}" } }] }, "tool_calls");

/** Ход из трёх шагов (инструмент, инструмент, текст) у DeepSeek напрямую; тела запросов по шагам как текст. */
async function threeStepBodies(): Promise<string[]> {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      bodies.push(String(init?.body));
      if (bodies.length === 1) return toolCall("call_1");
      if (bodies.length === 2) return toolCall("call_2");
      return deepSeekStream({ content: "Готово." }, "stop");
    }),
  );
  const tools = { lookup: tool({ description: "Поиск", inputSchema: z.object({}), execute: async () => "найдено" }) };
  const storage = await storageWithQuestion();
  await readAll(
    startTurn(storage, undefined as never, {
      catalog: standardCatalog,
      modelId: "deepseek-4.1-flash",
      providerId: "deepseek",
      env: { DEEPSEEK_API_KEY: "test-key" },
      tools,
    }),
  );
  return bodies;
}

describe("автоматический кэш (DeepSeek): метки шага нет (SC-006)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ни одного cache_control ни на одном шаге", async () => {
    const bodies = await threeStepBodies();
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body).not.toContain("cache_control");
      expect(body).not.toContain("cacheControl");
    }
  });

  it("сообщения шага — побайтно сообщения прошлого шага плюс новые: ничего не переставлено и не помечено", async () => {
    const bodies = (await threeStepBodies()).map((body) => JSON.parse(body) as Body);
    for (let step = 1; step < bodies.length; step++) {
      const previous = bodies[step - 1]!.messages;
      const current = bodies[step]!.messages;
      expect(current.length).toBeGreaterThan(previous.length);
      expect(JSON.stringify(current.slice(0, previous.length))).toBe(JSON.stringify(previous));
    }
  });
});
