// Живой замер сценариев (T111). Платный: около 30 запросов к DeepSeek 4.1 Flash и 50 к decision-1, меньше $0,05.
// (а) SC-002: чат по «Разбору» на 10 ходов с тремя и больше переходами (судья — настоящий decision-1). По каждому
//     запросу — вход и сколько из кэша; промах кэша — строка `[промах кэша]` журнала ядра.
// (б) SC-004: набор tests/judge-cases.json на decision-1 и на запасной модели (DeepSeek 4.1 Flash) — не меньше 18 из 20,
//     цена вызова основного судьи — не больше 1/10 средней цены хода из (а). Цена запасной только печатается: здесь она
//     та же модель, что у агента, и вызов стоит как полхода (замер 2026-10-13 — docs/flows.md, раздел «Замеры»).
// Ключи — только из окружения (`pnpm secrets:load`), в вывод не попадают. Запуск: `pnpm test:live flow-measure`.
// Итоги печатаются строками `[flow-measure]`.
import { readFileSync } from "node:fs";
import { createChatService, createInMemoryChatStorage, standardCatalog, type ModelChoice, type RecordExternalUsageInput } from "@ykurilov/agent-chat-core";
import { tool } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { activeExits, stateById } from "../../src/engine/flow-graph";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import type { JudgeMessage } from "../../src/runtime/flow-types";
import { createFlowJudge } from "../../src/runtime/judge";
import { memoryFlowStore } from "../../src/store/memory";
import { fixtureFlow, fixtureJson, type FixtureName } from "../flow-fixtures";

if (!process.env.OPENROUTER_API_KEY || !process.env.DEEPSEEK_API_KEY) throw new Error("Нет OPENROUTER_API_KEY или DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

const OWNER = "flow-measure";
const MODEL: ModelChoice = { modelId: "deepseek-4.1-flash", providerId: "deepseek" };
const report = (label: string, value: unknown) => process.stdout.write(`[flow-measure] ${label} ${JSON.stringify(value)}\n`);

const HUMAN = [
  "Здравствуйте!",
  "Меня зовут Ольга. У меня курс по акварели для новичков, продала пока 3 штуки.",
  "Люди приходят из инстаграма, но до покупки почти никто не доходит.",
  "Смотрят бесплатные уроки, а потом пропадают. Наверное, не доверяют мне как преподавателю.",
  "Да, согласна: главный затык — после бесплатных уроков нет доверия. Это и мешает.",
  "А что будет на разборе?",
  "Не знаю… у меня мало времени, и вдруг это не поможет.",
  "Ну 30 минут, наверное, найду.",
  "А разбор точно бесплатный?",
  "Хорошо, спасибо.",
];

interface RecordedCall {
  turn: number;
  promptTokens?: number;
  cachedTokens?: number;
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;
let currentTurn = 0;
let averageTurnCost = 0;

/** Пишет только числа расхода запросов к DeepSeek; ключ и тексты не пишутся. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string" || !String(input).includes("deepseek.com") || !String(input).endsWith("/chat/completions")) return originalFetch(input, init);
    const call: RecordedCall = { turn: currentTurn };
    calls.push(call);
    const response = await originalFetch(input, init);
    pendingReads.push(
      response
        .clone()
        .text()
        .then((text) => {
          for (const line of text.split("\n").reverse()) {
            const json = line.startsWith("data:") ? line.slice(5) : line;
            if (!json.includes('"usage"')) continue;
            try {
              const usage = (JSON.parse(json) as { usage?: { prompt_tokens?: number; prompt_cache_hit_tokens?: number } }).usage;
              if (!usage) continue;
              call.promptTokens = usage.prompt_tokens;
              call.cachedTokens = usage.prompt_cache_hit_tokens ?? 0;
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

async function drain(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

describe("сценарий на настоящих моделях", () => {
  it("(а) 10 ходов по «Разбору», три перехода — без промахов кэша из-за перехода", async () => {
    const journal: string[] = [];
    const log = (message: string) => {
      journal.push(String(message));
      process.stdout.write(`[flow-measure-log] ${String(message)}\n`);
    };
    const storage = createInMemoryChatStorage();
    const flowJson = fixtureJson("sales-review");
    const flow = buildAgentFlow({
      loadFlow: async () => ({ flowId: "sales-review", versionId: "1", flow: flowJson }),
      store: memoryFlowStore(),
      judge: { fallback: MODEL },
      logError: log,
    });
    const service = createChatService({
      storage,
      catalog: standardCatalog,
      defaultChoice: MODEL,
      env: process.env,
      logError: log,
      ...flow.withChat({
        agent: {
          instructions: "Ты помощник наставника по онлайн-курсам. Отвечай по-русски, коротко: два-три предложения.",
          tools: {
            give_booking_link: tool({ description: "Ссылка на запись к Анне на разбор", inputSchema: z.object({}), execute: async () => "https://example.com/book" }),
            call_expert: tool({ description: "Позвать Анну в разговор", inputSchema: z.object({ reason: z.string() }), execute: async () => "Анна получила уведомление" }),
          },
        },
      }),
    });
    flow.attach(service);

    const chat = await service.createChat(OWNER);
    await service.setModel(OWNER, chat.id, { ...MODEL, reasoning: "off" });
    const states: string[] = [];
    for (const [index, text] of HUMAN.entries()) {
      currentTurn = index + 1;
      await drain(await service.sendMessage(OWNER, chat.id, { id: `h${index}`, role: "user", parts: [{ type: "text", text }] }));
      await Promise.all(pendingReads);
      await flow.settled();
      states.push((await flow.readRun(OWNER, chat.id))?.state ?? "?");
    }
    const run = await flow.readRun(OWNER, chat.id);
    const transitions = (run?.path ?? []).filter((step) => step.decidedBy !== "start");
    const answers = await storage.sumUsage({ ownerId: OWNER, chatId: chat.id, source: "answer" });
    const judged = await storage.sumUsage({ ownerId: OWNER, chatId: chat.id, source: "judge" });
    const answerCost = answers.reduce((sum, entry) => sum + entry.costUsd, 0);
    averageTurnCost = answerCost / HUMAN.length;
    const turns = HUMAN.map((_, index) => {
      const own = calls.filter((call) => call.turn === index + 1);
      return {
        turn: index + 1,
        state: states[index],
        requests: own.length,
        input: own.map((call) => call.promptTokens ?? null),
        cached: own.map((call) => call.cachedTokens ?? null),
      };
    });
    const cacheMisses = journal.filter((line) => line.includes("[промах кэша]"));
    report("cache-turns", turns);
    report("cache-path", run?.path.map(({ state, decidedBy, probability }) => ({ state, decidedBy, probability })));
    report("cache-cost", { answerCost, averageTurnCost, judge: judged });
    report("cache-misses", cacheMisses);

    expect(transitions.length).toBeGreaterThanOrEqual(3);
    expect(cacheMisses).toEqual([]);
    // Каждый ход, начиная со второго, читает из кэша не меньше входа последнего запроса прошлого хода минус хвост.
    for (let turn = 2; turn <= HUMAN.length; turn += 1) {
      const first = calls.find((call) => call.turn === turn)!;
      const previousLast = calls.filter((call) => call.turn === turn - 1).at(-1)!;
      expect(first.cachedTokens!).toBeGreaterThan(previousLast.promptTokens! * 0.8);
    }
  }, 600_000);

  interface JudgeCase {
    id: string;
    flow: FixtureName;
    state: string;
    exitId: string;
    expected: boolean;
    messages: JudgeMessage[];
  }
  const { cases } = JSON.parse(readFileSync(new URL("../judge-cases.json", import.meta.url), "utf8")) as { cases: JudgeCase[] };

  function resolve(testCase: JudgeCase) {
    const parsed = fixtureFlow(testCase.flow);
    const state = stateById(parsed, testCase.state)!;
    const active = activeExits(parsed, state).find(({ exit }) => exit.id === testCase.exitId)!;
    if (active.exit.when.type !== "judge") throw new Error(`${testCase.id}: не условие словами`);
    return { goal: state.instructions.split("\n")[0]!, condition: active.exit.when.text };
  }

  it.each([["decision"], ["fallback"]] as const)("(б) набор судьи, %s: не меньше 18 из 20", async (source) => {
    const storage = createInMemoryChatStorage();
    const service = createChatService({ storage, catalog: standardCatalog, defaultChoice: MODEL, env: process.env, agent: { instructions: "" }, logError: () => {} });
    const usage: RecordExternalUsageInput[] = [];
    const judge = createFlowJudge(
      { fallback: MODEL },
      () => ({ assertWithinLimit: service.assertWithinLimit, askModel: service.askModel, recordUsage: async (input) => void usage.push(input) }),
      // Запасная: у судьи нет ключа OpenRouter, и он сразу зовёт запасную модель.
      { env: source === "decision" ? process.env : {}, logError: () => {} },
    );
    const rows: Array<{ id: string; expected: boolean; got: boolean | null; probability: number | null; source: string | null }> = [];
    for (const testCase of cases) {
      const { goal, condition } = resolve(testCase);
      const verdict = await judge.checkClaim({ ownerId: OWNER, chatId: `judge-${source}`, exitId: testCase.exitId, condition, goal, messages: testCase.messages });
      rows.push({ id: testCase.id, expected: testCase.expected, got: verdict?.confirmed ?? null, probability: verdict?.probability ?? null, source: verdict?.source ?? null });
    }
    const correct = rows.filter((row) => row.got === row.expected).length;
    const fallbackUsage = await storage.sumUsage({ source: "judge" });
    const totalCost = source === "decision" ? usage.reduce((sum, entry) => sum + entry.cost, 0) : fallbackUsage.reduce((sum, entry) => sum + entry.costUsd, 0);
    const perCall = totalCost / cases.length;
    report(`judge-${source}`, { correct, totalCost, perCall, averageTurnCost, rows });

    expect(rows.every((row) => row.source === source)).toBe(true);
    expect(correct).toBeGreaterThanOrEqual(18);
    if (source === "decision" && averageTurnCost > 0) expect(perCall).toBeLessThanOrEqual(averageTurnCost / 10);
  }, 600_000);
});
