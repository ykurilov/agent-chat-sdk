import { tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { readAll } from "../support/mock-model";
import { startTurn, storageWithQuestion } from "../support/turn-fixtures";

type Body = { messages: Array<{ role: string; content?: unknown }> };

/** Ответ OpenRouter потоком: вызов инструмента или текст. */
function openRouterStream(delta: Record<string, unknown>, finishReason: string): Response {
  const chunk = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", provider: "p" };
  const lines = [
    { ...chunk, choices: [{ index: 0, delta: { role: "assistant", ...delta } }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const toolCall = (id: string) => openRouterStream({ tool_calls: [{ index: 0, id, type: "function", function: { name: "lookup", arguments: "{}" } }] }, "tool_calls");

/**
 * Ход из трёх шагов (инструмент, инструмент, текст) через OpenRouter; тела запросов по шагам. По умолчанию GPT: у моделей
 * Google метка с самого конца запроса переезжает на предпоследнее сообщение (последний тест).
 */
async function threeStepBodies(extra: Parameters<typeof startTurn>[2] = {}, modelId = "gpt-6-luna"): Promise<Body[]> {
  const bodies: Body[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      bodies.push(JSON.parse(String(init?.body)) as Body);
      if (bodies.length === 1) return toolCall("call_1");
      if (bodies.length === 2) return toolCall("call_2");
      return openRouterStream({ content: "Готово." }, "stop");
    }),
  );
  const tools = { lookup: tool({ description: "Поиск", inputSchema: z.object({}), execute: async () => "найдено" }) };
  const storage = await storageWithQuestion();
  await readAll(
    startTurn(storage, undefined as never, {
      catalog: standardCatalog,
      modelId,
      providerId: "openrouter",
      env: { OPENROUTER_API_KEY: "test-key" },
      tools,
      ...extra,
    }),
  );
  return bodies;
}

/** Сколько меток `cache_control` в значении. */
function cacheMarks(value: unknown): number {
  let count = 0;
  JSON.stringify(value, (key, inner) => {
    if (key === "cache_control") count++;
    return inner;
  });
  return count;
}

describe("OpenRouter: метка кэша на конце шага (FR-012)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("на каждом шаге после первого метка на последнем сообщении; меток не больше трёх", async () => {
    const bodies = await threeStepBodies();
    expect(bodies).toHaveLength(3);
    // шаг 0: инструкция и последнее сообщение истории
    expect(cacheMarks(bodies[0])).toBe(2);
    for (const body of bodies.slice(1)) {
      expect(cacheMarks(body)).toBeLessThanOrEqual(3);
      expect(cacheMarks(body)).toBe(3);
      const last = body.messages.at(-1)!;
      expect(last.role).toBe("tool");
      expect(cacheMarks(last)).toBe(1);
    }
  });

  it("метка прошлого шага на следующем снята: результат первого инструмента на шаге 2 без метки", async () => {
    const bodies = await threeStepBodies();
    const firstResult = bodies[1]!.messages.at(-1)!;
    const sameOnStep2 = bodies[2]!.messages[bodies[1]!.messages.length - 1]!;
    expect(cacheMarks(firstResult)).toBe(1);
    expect(cacheMarks(sameOnStep2)).toBe(0);
    expect(JSON.stringify(sameOnStep2)).toBe(JSON.stringify(firstResult).replace(/,?"cache_control":\{[^}]*\}/, ""));
  });

  it("со снимком шага метка — на последнем сохраняемом сообщении, снимок после неё и без метки", async () => {
    const bodies = await threeStepBodies({ stepContext: ({ stepNumber }) => `Снимок шага ${stepNumber}` });
    for (const [step, body] of bodies.entries()) {
      const snapshot = body.messages.at(-1)!;
      expect(JSON.stringify(snapshot)).toContain(`Снимок шага ${step}`);
      expect(cacheMarks(snapshot)).toBe(0);
      expect(cacheMarks(body.messages.at(-2))).toBe(1);
      expect(cacheMarks(body)).toBeLessThanOrEqual(3);
    }
    expect(bodies[1]!.messages.at(-2)!.role).toBe("tool");
  });

  it("на последнем шаге хода пометка «подведи итог» идёт после метки и без неё", async () => {
    const bodies = await threeStepBodies({ maxSteps: 3 });
    const last = bodies[2]!.messages;
    expect(cacheMarks(last.at(-1))).toBe(0);
    expect(last.at(-2)!.role).toBe("tool");
    expect(cacheMarks(last.at(-2))).toBe(1);
    expect(cacheMarks(bodies[2])).toBe(3);
  });

  it("Gemini: метка конца шага не на самом конце запроса, а на вызове инструмента перед результатом", async () => {
    const bodies = await threeStepBodies({}, "gemini-3.8-flash");
    for (const body of bodies.slice(1)) {
      expect(body.messages.at(-1)!.role).toBe("tool");
      expect(cacheMarks(body.messages.at(-1))).toBe(0);
      expect(body.messages.at(-2)!.role).toBe("assistant");
      expect(cacheMarks(body.messages.at(-2))).toBe(1);
    }
  });
});
