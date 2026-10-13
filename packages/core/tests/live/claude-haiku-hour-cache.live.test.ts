// Живая проверка Claude Haiku 5.5 через OpenRouter (standardCatalog, настоящий createChatService):
//   1. Чат из двух ходов с инструментом: метки кэша с ttl "1h", их не больше 4; со второго запроса вход читается из кэша;
//      стоимость каждого запроса по ценам профиля (запись по часовой цене) совпадает с usage.cost OpenRouter и с
//      generation API (GET /api/v1/generation?id=…).
//   2. Уровни рассуждений профиля в том же чате: сколько токенов рассуждений и читается ли кэш после смены уровня.
//   3. Картинка в результате инструмента — у каждого хозяина модели в OpenRouter по 2 попытки.
// Платный: около $0,01 (замер 2026-10-11). Ключ — только из окружения (`pnpm secrets:load`).
// Запуск: `pnpm test:live claude-haiku-hour-cache`. Итог печатается строкой `[haiku-hour-cache]`.
import { deflateSync } from "node:zlib";
import { generateText, jsonSchema, tool, type ModelMessage } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import type { ReasoningLevelId } from "../../src/models/model-catalog";
import { openrouterProvider } from "../../src/models/providers/openrouter";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { costOfUsage } from "../../src/usage/usage-cost";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "claude-haiku-5.5";
const providerId = "openrouter";
const ownerId = "haiku-tester";
const profile = standardCatalog.models.find((model) => model.id === modelId)!;
const price = profile.pricing![providerId]!;

interface RecordedCall {
  marks: unknown[];
  generationId?: string;
  promptTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cost?: number;
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;

function cacheControls(body: unknown): unknown[] {
  const found: unknown[] = [];
  JSON.stringify(body, (key, value) => {
    if (key === "cache_control") found.push(value);
    return value;
  });
  return found;
}

/** Службе чата `fetch` не передать: на время теста подменяется глобальный. Пишет метки запроса и числа расхода. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string" || !String(input).includes("/chat/completions")) return originalFetch(input, init);
    const call: RecordedCall = { marks: cacheControls(JSON.parse(init.body)) };
    calls.push(call);
    const response = await originalFetch(input, init);
    call.generationId = response.headers.get("x-generation-id") ?? undefined;
    pendingReads.push(
      response
        .clone()
        .text()
        .then((text) => {
          for (const line of text.split("\n").reverse()) {
            if (!line.startsWith("data:") || !line.includes('"usage"')) continue;
            try {
              const parsed = JSON.parse(line.slice(5)) as {
                id?: string;
                usage?: {
                  prompt_tokens: number;
                  completion_tokens: number;
                  cost?: number;
                  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
                  completion_tokens_details?: { reasoning_tokens?: number };
                };
              };
              const usage = parsed.usage;
              if (!usage) continue;
              call.generationId ??= parsed.id;
              call.promptTokens = usage.prompt_tokens;
              call.cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
              call.cacheWriteTokens = usage.prompt_tokens_details?.cache_write_tokens ?? 0;
              call.outputTokens = usage.completion_tokens;
              call.reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
              call.cost = usage.cost;
              return;
            } catch {
              // неполная строка потока
            }
          }
        })
        .catch(() => {}),
    );
    return response;
  };
}

beforeAll(() => {
  globalThis.fetch = recordingFetch();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const ourCost = (call: RecordedCall) =>
  costOfUsage(
    { inputTokens: call.promptTokens ?? 0, cachedInputTokens: call.cachedTokens ?? 0, cacheWriteTokens: call.cacheWriteTokens ?? 0, outputTokens: call.outputTokens ?? 0 },
    price,
  );

/** Стоимость генерации по generation API; данные появляются через 10–20 с. */
async function generationCost(generationId: string): Promise<number | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await originalFetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (response.ok) {
      const { data } = (await response.json()) as { data?: { total_cost?: number } };
      if (data?.total_cost !== undefined) return data.total_cost;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return null;
}

async function drain(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

const instructionsFor = (runLabel: string) =>
  [
    `Метка прогона: ${runLabel}.`,
    "Ты аккуратный помощник склада. Остатки товара узнаёшь только инструментом stock. Отвечай коротко, по-русски.",
    "Справка по складу:",
    ...Array.from({ length: 250 }, (_, index) => `Пункт ${index + 1}. Стеллаж ${index + 1} принимает ящики по чётным дням и отмечает приёмку в журнале склада.`),
  ].join("\n");

describe("Claude Haiku 5.5 через OpenRouter: часовой кэш, цена, уровни, картинка из инструмента", () => {
  it("чат из нескольких ходов с инструментом", async () => {
    const runLabel = `hk-${Date.now().toString(36)}`;
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId, providerId },
      agent: {
        instructions: instructionsFor(runLabel),
        tools: {
          stock: tool({
            description: "Остаток товара на складе по названию.",
            inputSchema: z.object({ item: z.string() }),
            execute: async ({ item }) => `${item}: ${item.length * 7} шт.`,
          }),
        },
      },
      env: process.env,
      logError: () => {},
    });
    const chat = await service.createChat(ownerId);
    const send = async (id: string, text: string) => {
      await drain(await service.sendMessage(ownerId, chat.id, { id, role: "user", parts: [{ type: "text", text }] }));
      await Promise.all(pendingReads);
    };
    await send("u1", "Сколько на складе гвоздей? Узнай инструментом.");
    const chatCalls = calls.length;
    await send("u2", "А шурупов? Тоже инструментом.");
    const turnCalls = calls.slice();

    // Уровни рассуждений в том же чате: короткий вопрос на каждый уровень.
    const levels: Array<{ level: ReasoningLevelId } & RecordedCall> = [];
    for (const level of profile.reasoning.levels!) {
      await service.setModel(ownerId, chat.id, { modelId, providerId, reasoning: level });
      const from = calls.length;
      await send(`l-${level}`, "Сколько простых чисел меньше 60? Ответь одним числом, без инструментов.");
      levels.push({ level, ...calls[from]! });
    }

    const costs = await Promise.all(turnCalls.map(async (call) => ({ ...call, ours: ourCost(call), generation: call.generationId ? await generationCost(call.generationId) : null })));
    process.stdout.write(
      `[haiku-hour-cache] ${JSON.stringify({
        chatTurns: costs.map(({ marks, promptTokens, cachedTokens, cacheWriteTokens, outputTokens, cost, ours, generation }) => ({
          marks: marks.length,
          hourMarks: marks.every((mark) => JSON.stringify(mark) === '{"type":"ephemeral","ttl":"1h"}'),
          promptTokens,
          cachedTokens,
          cacheWriteTokens,
          outputTokens,
          openrouterCost: cost,
          generationCost: generation,
          ourCost: Number(ours.toFixed(8)),
        })),
        levels: levels.map(({ level, reasoningTokens, outputTokens, cachedTokens, cacheWriteTokens, promptTokens }) => ({ level, reasoningTokens, outputTokens, promptTokens, cachedTokens, cacheWriteTokens })),
        totalCost: calls.reduce((sum, call) => sum + (call.cost ?? 0), 0),
      })}\n`,
    );

    expect(chatCalls, "первый ход — вызов инструмента и ответ").toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.marks.length).toBeGreaterThan(0);
      expect(call.marks.length).toBeLessThanOrEqual(4);
      expect(call.marks.every((mark) => JSON.stringify(mark) === '{"type":"ephemeral","ttl":"1h"}')).toBe(true);
    }
    expect(costs[0]!.cacheWriteTokens, "первый запрос пишет кэш").toBeGreaterThan(0);
    for (const call of costs.slice(1)) expect(call.cachedTokens, "следующие запросы читают кэш").toBeGreaterThan(0);
    for (const call of costs) {
      expect(call.ours).toBeCloseTo(call.cost!, 6);
      if (call.generation !== null) expect(call.ours).toBeCloseTo(call.generation, 6);
    }
    expect(levels.find((entry) => entry.level === "off")!.reasoningTokens).toBe(0);
    expect(levels.find((entry) => entry.level === "max")!.reasoningTokens).toBeGreaterThan(0);
  }, 600_000);

  it("картинка в результате инструмента — у каждого хозяина модели", async () => {
    const response = await originalFetch(`https://openrouter.ai/api/v1/models/${profile.providerModelIds.openrouter}/endpoints`, { headers: { authorization: `Bearer ${apiKey}` } });
    const endpoints = ((await response.json()) as { data: { endpoints: Array<{ tag: string; provider_name: string }> } }).data.endpoints;
    const reasoning = openrouterProvider.reasoningRequest!(profile.reasoning.defaultLevel!, { profile, providerModelId: profile.providerModelIds.openrouter! });
    const results = await Promise.all(
      endpoints.flatMap((endpoint) =>
        [1, 2].map(async () => {
          try {
            const result = await generateText({
              model: openrouterProvider.createLanguageModel(profile.providerModelIds.openrouter!, apiKey),
              messages: pictureMessages,
              tools: { show_picture: tool({ description: "Shows you a picture.", inputSchema: jsonSchema({ type: "object", properties: {} }) }) },
              maxOutputTokens: 2000,
              maxRetries: 0,
              providerOptions: { openrouter: { ...reasoning.providerOptions?.openrouter, provider: { only: [endpoint.tag], allow_fallbacks: false } } },
            });
            const lower = result.text.toLowerCase();
            return { host: endpoint.provider_name, sees: /yellow/.test(lower) && /purple|violet|magenta|lavender/.test(lower), answer: result.text.slice(0, 120) };
          } catch (error) {
            return { host: endpoint.provider_name, sees: false, answer: `ошибка: ${(error as Error).message.slice(0, 120)}` };
          }
        }),
      ),
    );
    process.stdout.write(`[haiku-hour-cache] ${JSON.stringify({ toolResultImage: results })}\n`);
    expect(results.length).toBeGreaterThan(0);
  }, 300_000);
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG 256×128: левая половина жёлтая, правая фиолетовая; base64. */
function halvesPng(): string {
  const width = 256;
  const height = 128;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const pixels = Array.from({ length: width }, (_, x) => (x < width / 2 ? [240, 210, 20] : [140, 30, 200])).flat();
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(pixels)]);
  const data = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", data), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

const pictureMessages: ModelMessage[] = [
  { role: "user", content: "Call show_picture, then tell me what you see: which colors, and where." },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_1", toolName: "show_picture", input: {} }] },
  {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "show_picture",
      output: { type: "content", value: [{ type: "text", text: "The picture:" }, { type: "file", data: { type: "data", data: halvesPng() }, mediaType: "image/png" }] },
    }],
  },
];
