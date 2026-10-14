import type { LanguageModelV4, LanguageModelV4Prompt } from "@ai-sdk/provider";
import { tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { limitCacheMarks, openrouterCacheMarkLimit } from "../../../src/models/providers/openrouter-cache-mark-limit";
import { openrouterProvider } from "../../../src/models/providers/openrouter";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { readAll } from "../support/mock-model";
import { startTurn, storageWithQuestion } from "../support/turn-fixtures";

type Body = { messages: Array<{ role: string; content?: unknown }> };

/** Ответ OpenRouter потоком: вызовы инструментов или текст. */
function openRouterStream(delta: Record<string, unknown>, finishReason: string): Response {
  const chunk = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", provider: "p" };
  const lines = [
    { ...chunk, choices: [{ index: 0, delta: { role: "assistant", ...delta } }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const parallelCalls = (names: string[]) =>
  openRouterStream({ tool_calls: names.map((name, index) => ({ index, id: `call_${name}`, type: "function", function: { name, arguments: "{}" } })) }, "tool_calls");

/** Сколько меток `cache_control` в итоговом теле запроса. */
function cacheMarks(value: unknown): number {
  let count = 0;
  JSON.stringify(value, (key, inner) => {
    if (key === "cache_control") count++;
    return inner;
  });
  return count;
}

const tools = Object.fromEntries(
  ["set_title", "list_files", "read_file"].map((name) => [name, tool({ description: name, inputSchema: z.object({}), execute: async () => `итог ${name}` })]),
);

/** Ход через OpenRouter: шаг 0 — параллельные вызовы, шаг 1 — текст. Тела запросов по шагам. */
async function parallelCallBodies(modelId: string): Promise<Body[]> {
  const bodies: Body[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      bodies.push(JSON.parse(String(init?.body)) as Body);
      return bodies.length === 1 ? parallelCalls(["set_title", "list_files", "read_file"]) : openRouterStream({ content: "Готово." }, "stop");
    }),
  );
  const storage = await storageWithQuestion();
  await readAll(startTurn(storage, undefined as never, { catalog: standardCatalog, modelId, providerId: "openrouter", env: { OPENROUTER_API_KEY: "test-key" }, tools }));
  return bodies;
}

/** Тело, которое провайдер OpenRouter отправит для `prompt` (сеть подменена, ответ — ошибка). */
async function sentBody(providerModelId: string, prompt: LanguageModelV4Prompt): Promise<string> {
  let body = "";
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    body = String(init?.body);
    return new Response("{}", { status: 400 });
  };
  const model = openrouterProvider.createLanguageModel(providerModelId, "k", { fetch }) as LanguageModelV4;
  await Promise.resolve(model.doStream({ prompt })).catch(() => undefined);
  return body;
}

const hour = { openrouter: { cacheControl: { type: "ephemeral", ttl: "1h" } } };
const resultPart = (id: string, providerOptions?: typeof hour) => ({
  type: "tool-result" as const,
  toolCallId: id,
  toolName: "lookup",
  output: { type: "text" as const, value: "итог" },
  ...(providerOptions && { providerOptions }),
});
/** Запрос с меткой на каждом из трёх результатов — как SDK ставил до 0.46.2: пять меток. */
const fiveMarks: LanguageModelV4Prompt = [
  { role: "system", content: "Ты помощник.", providerOptions: hour },
  { role: "user", content: [{ type: "text", text: "Привет" }], providerOptions: hour },
  { role: "assistant", content: ["c1", "c2", "c3"].map((id) => ({ type: "tool-call" as const, toolCallId: id, toolName: "lookup", input: "{}" })) },
  { role: "tool", content: ["c1", "c2", "c3"].map((id) => resultPart(id)), providerOptions: hour },
];

describe("OpenRouter: не больше 4 меток cache_control у Claude", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("предел есть только у Claude", () => {
    expect(openrouterCacheMarkLimit("anthropic/claude-haiku-5.5")).toBe(4);
    expect(openrouterCacheMarkLimit("~anthropic/claude-haiku-latest")).toBe(4);
    for (const id of ["openai/gpt-6-luna", "google/gemini-3.8-flash", "deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash"]) {
      expect(openrouterCacheMarkLimit(id)).toBeUndefined();
    }
  });

  it("причина: метку сообщения с результатами провайдер OpenRouter ставит на каждый результат — пять меток", async () => {
    // Так было в проде (конструктора приложений, 0.46.0): инструкция, вопрос, три параллельных вызова — Anthropic отверг запрос.
    expect(cacheMarks(JSON.parse(await sentBody("openai/gpt-6-luna", fiveMarks)))).toBe(5);
  });

  it("у Claude лишние метки снимаются в теле запроса: инструкция и последние три", async () => {
    const body = JSON.parse(await sentBody("anthropic/claude-haiku-5.5", fiveMarks)) as Body;
    expect(cacheMarks(body)).toBe(4);
    expect(body.messages.map((message) => cacheMarks(message))).toEqual([1, 0, 0, 1, 1, 1]);
  });

  it("у модели не Claude тело запроса не трогается", async () => {
    const prompt: LanguageModelV4Prompt = [...fiveMarks.slice(0, 3), { role: "tool", content: ["c1", "c2", "c3"].map((id) => resultPart(id, hour)) }];
    const gpt = await sentBody("openai/gpt-6-luna", prompt);
    expect(cacheMarks(JSON.parse(gpt))).toBe(5);
  });

  it("метка на одном результате: тело побайтно то же, что с меткой на сообщении (как до 0.46.2)", async () => {
    const onMessage: LanguageModelV4Prompt = [...fiveMarks.slice(0, 2), { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" }] }, { role: "tool", content: [resultPart("c1")], providerOptions: hour }];
    const onPart: LanguageModelV4Prompt = [...onMessage.slice(0, 3), { role: "tool", content: [resultPart("c1", hour)] }];
    for (const id of ["openai/gpt-6-luna", "anthropic/claude-haiku-5.5"]) expect(await sentBody(id, onPart)).toBe(await sentBody(id, onMessage));
  });

  it("не Claude, три параллельных вызова: меток три — метка конца шага одна, на последнем результате", async () => {
    const bodies = await parallelCallBodies("gpt-6-luna");
    const results = bodies[1]!.messages.filter((message) => message.role === "tool");
    expect(results.map((message) => cacheMarks(message))).toEqual([0, 0, 1]);
    expect(cacheMarks(bodies[1])).toBe(3);
  });

  it("три параллельных вызова инструментов: на следующем шаге меток не больше 4", async () => {
    const bodies: Body[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { body?: unknown }) => {
        if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
        bodies.push(JSON.parse(String(init?.body)) as Body);
        return bodies.length === 1 ? parallelCalls(["set_title", "list_files", "read_file"]) : openRouterStream({ content: "Готово." }, "stop");
      }),
    );
    const storage = await storageWithQuestion();
    await readAll(
      startTurn(storage, undefined as never, {
        catalog: standardCatalog,
        modelId: "claude-haiku-5.5",
        providerId: "openrouter",
        env: { OPENROUTER_API_KEY: "test-key" },
        tools,
      }),
    );
    expect(bodies).toHaveLength(2);
    expect(cacheMarks(bodies[1])).toBeLessThanOrEqual(4);
  });
});

describe("limitCacheMarks", () => {
  const mark = (ttl?: string) => ({ type: "ephemeral", ...(ttl && { ttl }) });
  const text = (value: string, cacheControl?: object) => ({ type: "text", text: value, ...(cacheControl && { cache_control: cacheControl }) });

  it("меток не больше предела — та же строка", () => {
    const body = JSON.stringify({ messages: [{ role: "system", content: [text("и", mark())] }, { role: "user", content: [text("в", mark())] }] });
    expect(limitCacheMarks(body, 4)).toBe(body);
  });

  it("ключ cache_control внутри текста не метка: строка не меняется", () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: '"cache_control": "cache_control": "cache_control": "cache_control": "cache_control":' }] });
    expect(limitCacheMarks(body, 4)).toBe(body);
  });

  it("порядок сохранения: последняя, инструкция, затем более поздние; часовые остаются перед пятиминутными", () => {
    const body = JSON.stringify({
      messages: [
        { role: "system", content: [text("инструкция", mark("1h"))] },
        { role: "user", content: [text("вопрос", mark("1h"))] },
        { role: "tool", tool_call_id: "c1", content: "1", cache_control: mark("1h") },
        { role: "tool", tool_call_id: "c2", content: "2", cache_control: mark("1h") },
        { role: "user", content: [text("поправка", mark()), text("ещё", mark())] },
      ],
    });
    const limited = JSON.parse(limitCacheMarks(body, 4)) as Body;
    expect(limited.messages.map((message) => cacheMarks(message))).toEqual([1, 0, 0, 1, 2]);
    const ttls: unknown[] = [];
    JSON.stringify(limited, (key, value) => (key === "cache_control" ? (ttls.push((value as { ttl?: string }).ttl ?? "5m"), value) : value));
    expect(ttls).toEqual(["1h", "1h", "5m", "5m"]);
  });

  it("метки верхнего уровня и у инструментов не снимаются, но место занимают", () => {
    const body = JSON.stringify({
      cache_control: mark(),
      tools: [{ type: "function", function: { name: "t" }, cache_control: mark() }],
      messages: [{ role: "system", content: [text("и", mark())] }, { role: "user", content: [text("в", mark())] }, { role: "tool", content: "р", cache_control: mark() }],
    });
    const limited = JSON.parse(limitCacheMarks(body, 4)) as Body & { cache_control?: unknown };
    expect(cacheMarks(limited)).toBe(4);
    expect(limited.cache_control).toBeDefined();
    expect(limited.messages.map((message) => cacheMarks(message))).toEqual([1, 0, 1]);
  });
});
