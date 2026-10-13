// Живой замер застывающего контекста (035, T014): сколько входа хода N+1 читается из кэша. Разговор из 3 ходов, на
// первом агент вызывает инструмент; инструкция около 2500 токенов, блок памяти около 600, результат инструмента около
// 1500. На ходе 3 одна запись памяти меняется. Модели: Gemini 3.8 Flash через OpenRouter (явные метки кэша) и DeepSeek
// 4.1 Flash (автоматический кэш). Тот же файл, запущенный на ветке до 035, даёт цифры «до».
// Замер 2026-10-11 (ход 2: прочитано из кэша / вход последнего запроса хода 1; «до» — v0.34.0, «после» — 035):
//   - DeepSeek: до 4480 / 6865, после 6784 / 6866; ход 3: до 6016, после 6912 из 6937. Выигрыш есть.
//   - Gemini через OpenRouter: до 5556, с меткой на конце запроса 4183 (только инструкция), после переноса метки на
//     предпоследнее сообщение 6177 из 6194; ход 3 — 6252. OpenRouter пишет кэш Gemini до последней метки, а метку на
//     самом конце запроса пропускает.
// Тест платный (около 10 запросов на дешёвых моделях, меньше $0,03). Ключи — только из окружения (`pnpm secrets:load`).
// Запуск: `pnpm test:live frozen-context-cache`. Результат печатается строками `[frozen-context-result]`.
import { tool } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import type { LongTermMemory } from "../../src/memory/long-term-memory";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY || !process.env.DEEPSEEK_API_KEY) throw new Error("Нет OPENROUTER_API_KEY или DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

const ownerId = "frozen-context-tester";
const questions = [
  "Посмотри инструментом lookup справку по журналу 7 и ответь в двух предложениях, сколько хранятся записи.",
  "Спасибо. В двух предложениях: чем архив отличается от резервной копии?",
  "И последнее, в двух предложениях: кто удаляет записи по графику?",
];

const instructionsFor = (runLabel: string) =>
  [
    `Метка прогона: ${runLabel}.`,
    "Ты аккуратный помощник в тестовом стенде. Отвечай по-русски, строго в два предложения.",
    "Справку по журналу бери только инструментом lookup, по одному вызову.",
    ...Array.from({ length: 110 }, (_, index) => `Пункт ${index + 1}. Стенд ведёт журнал номер ${index + 1}; записи журнала хранятся неделю, потом архивируются и удаляются по графику.`),
  ].join("\n");

/** Память: 20 записей; к третьему ходу последняя меняется. */
const memoryFor = (turn: number) =>
  [
    "<agent_memory>",
    ...Array.from({ length: 19 }, (_, index) => `Заметка ${index + 1}. Собеседник ведёт стенд номер ${index + 1} и просит не путать архив с резервной копией.`),
    `Заметка 20. Последний раз собеседник спрашивал про журнал ${turn >= 3 ? 9 : 7}.`,
    "</agent_memory>",
  ].join("\n");

const lookupResult = Array.from({ length: 40 }, (_, index) => `Строка справки ${index + 1}: журнал 7 хранит записи семь дней, затем архивирует их и удаляет по графику уборки.`).join("\n");

interface RecordedCall {
  turn: number;
  marks?: string;
  usage?: unknown;
  promptTokens: number | undefined;
  cachedTokens: number | undefined;
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;
let currentTurn = 0;

/** Пишет только числа расхода; ключ и тексты не пишутся. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string" || !String(input).endsWith("/chat/completions")) return originalFetch(input, init);
    const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: unknown }> };
    const marks = body.messages.map((message, index) => (JSON.stringify(message).includes("cache_control") ? `${index}:${message.role}` : null)).filter(Boolean);
    const call: RecordedCall = { turn: currentTurn, marks: `${marks.join(",")} из ${body.messages.length}`, promptTokens: undefined, cachedTokens: undefined };
    calls.push(call);
    const response = await originalFetch(input, init);
    pendingReads.push(
      response
        .clone()
        .text()
        .then((text) => {
          for (const line of text.split("\n").reverse()) {
            if (!line.startsWith("data:") || !line.includes('"usage"')) continue;
            try {
              const usage = (
                JSON.parse(line.slice(5)) as {
                  usage?: { prompt_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
                }
              ).usage;
              if (!usage) continue;
              call.usage = usage;
              call.promptTokens = usage.prompt_tokens;
              call.cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
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

async function drain(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

beforeAll(() => {
  globalThis.fetch = recordingFetch();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function conversation(modelId: string, providerId: string, reasoning: string): Promise<RecordedCall[]> {
  const runLabel = `${modelId}-${Date.now().toString(36)}`;
  let turn = 0;
  const memory: LongTermMemory = { instructions: "", toolNames: [], tools: () => ({}), snapshot: async () => memoryFor(turn) };
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId, providerId },
    agent: {
      instructions: instructionsFor(runLabel),
      tools: { lookup: tool({ description: "Справка по журналу стенда", inputSchema: z.object({ journal: z.number() }), execute: async () => lookupResult }) },
    },
    memory,
    env: process.env,
    logError: (message) => process.stdout.write(`[frozen-context-log] ${String(message)}\n`),
  });
  const chat = await service.createChat(ownerId);
  await service.setModel(ownerId, chat.id, { modelId, providerId, reasoning });
  const from = calls.length;
  for (const [index, text] of questions.entries()) {
    turn = index + 1;
    currentTurn = turn;
    await drain(await service.sendMessage(ownerId, chat.id, { id: `u${index}-${runLabel}`, role: "user", parts: [{ type: "text", text }] }));
    await Promise.all(pendingReads);
  }
  return calls.slice(from);
}

/** По ходам: вход и прочитанное из кэша на первом запросе хода и вход последнего запроса прошлого хода. */
function summarize(list: RecordedCall[]) {
  return [1, 2, 3].map((turn) => {
    const own = list.filter((call) => call.turn === turn);
    const previousLast = list.filter((call) => call.turn === turn - 1).at(-1);
    return {
      turn,
      requests: own.length,
      firstPrompt: own[0]?.promptTokens ?? null,
      firstCached: own[0]?.cachedTokens ?? null,
      previousLastPrompt: previousLast?.promptTokens ?? null,
    };
  });
}

describe("застывающий контекст: кэш между ходами (T014)", () => {
  it.each([
    ["gemini-3.8-flash", "openrouter", "minimal"],
    ["deepseek-4.1-flash", "deepseek", "off"],
  ])("%s через %s: ход N+1 читает из кэша прошлый ход", async (modelId, providerId, reasoning) => {
    const list = await conversation(modelId, providerId, reasoning);
    const turns = summarize(list);
    process.stdout.write(`[frozen-context-result] ${JSON.stringify({ modelId, providerId, turns })}\n`);
    for (const call of list) process.stdout.write(`[frozen-context-call] ${JSON.stringify({ turn: call.turn, marks: call.marks, usage: call.usage })}\n`);
    expect(turns[0]!.requests).toBeGreaterThanOrEqual(2);
  }, 300_000);
});
