// Живой замер кэша на трёх днях сценария (SC-107, T1102). Платный: около 15 запросов к DeepSeek 4.1 Flash, меньше $0,05.
// Образец demo/three-day-program.json, рамки дня сжаты (мягкая с 3-го сообщения, жёсткая на 6-м), часы подменены:
// среда 15:00 — четверг 9:00 — пятница 9:00 — суббота 9:00 («срок вышел»). Судья — подделка, ни разу не подтверждает:
// ноды меняются только по дням. Проверяем: постоянная инструкция побайтно одна во все дни, ни одной строки
// `[промах кэша]`, каждый ход со второго читает из кэша почти весь прошлый запрос. День, рамки, местное время —
// только в хвосте запроса. Ключ — только из окружения (`pnpm secrets:load`), в вывод не попадает.
// Запуск: `pnpm test:live flow-days-cache`. Итоги печатаются строками `[flow-days-cache]`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createChatService, createInMemoryChatStorage, standardCatalog, type ModelChoice } from "@ykurilov/agent-chat-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { memoryFlowStore } from "../../src/store/memory";
import { fakeJudge } from "../runtime/flow-chat";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

const OWNER = "flow-days-cache";
const MSK = "Europe/Moscow";
const MODEL: ModelChoice = { modelId: "deepseek-4.1-flash", providerId: "deepseek" };
const report = (label: string, value: unknown) => process.stdout.write(`[flow-days-cache] ${label} ${JSON.stringify(value)}\n`);
/** Момент по Москве: день октября 2026 и часы. 14.10.2026 — среда. */
const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);

interface RecordedCall {
  turn: number;
  system: string;
  promptTokens?: number;
  cachedTokens?: number;
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;
let currentTurn = 0;

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/** Пишет только числа расхода и отпечаток системной части запроса к DeepSeek; ключ и тексты не пишутся. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string" || !String(input).includes("deepseek.com") || !String(input).endsWith("/chat/completions")) return originalFetch(input, init);
    const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: unknown }> };
    const system = body.messages.filter((message) => message.role === "system").map((message) => JSON.stringify(message.content)).join("\n");
    const call: RecordedCall = { turn: currentTurn, system: hashOf(system) };
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
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 15)) });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

async function drain(stream: ReadableStream<unknown> | null | undefined): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

/** Что происходит по часам: сообщение человека или тик таймеров. */
type Step = { at: number; human: string } | { at: number; tick: true };

const STEPS: Step[] = [
  // Среда, день 1 из 3.
  { at: msk(14, 15), human: "Здравствуйте! Хочу за три дня собрать свой первый результат — простой лендинг для курса по акварели." },
  { at: msk(14, 15, 5), human: "Меня зовут Ольга. Цель — страница, где можно записаться на пробный урок." },
  { at: msk(14, 15, 10), human: "Начала: заголовок и три пункта, чему научу. Что дальше?" },
  { at: msk(14, 15, 20), human: "Добавила кнопку записи. Черновик почти готов." },
  { at: msk(14, 15, 30), human: "А картинки куда лучше вставить?" },
  // 6-е сообщение — жёсткая рамка: готовая фраза без модели; ночное — записывается без ответа.
  { at: msk(14, 15, 40), human: "И последний вопрос на сегодня: какой цвет кнопки?" },
  { at: msk(14, 23, 30), human: "Не спится, подумала: может, добавить отзывы?" },
  // Четверг 9:00, день 2: выход «Сборки» по сроку, утреннее и ответ на ночное — один ход.
  { at: msk(15, 9), tick: true },
  { at: msk(15, 10), human: "Доброе утро! Отзывов пока два, оба от подруг. Ставить?" },
  { at: msk(15, 10, 10), human: "Хорошо, поставила. Что ещё доработать?" },
  // Пятница 9:00, день 3 — последний: переход в «Продажу».
  { at: msk(16, 9), tick: true },
  { at: msk(16, 10), human: "Готово, страница работает. Спасибо!" },
  { at: msk(16, 10, 10), human: "Расскажите, что дальше можно сделать?" },
  // Суббота 9:00: срок вышел — конец без хода модели.
  { at: msk(17, 9), tick: true },
];

describe("кэш на трёх днях сценария", () => {
  it("постоянная инструкция одна во все дни, промахов кэша нет", async () => {
    const journal: string[] = [];
    const log = (message: string) => {
      journal.push(String(message));
      process.stdout.write(`[flow-days-cache-log] ${String(message)}\n`);
    };
    const storage = createInMemoryChatStorage();
    const flowJson = JSON.parse(readFileSync(new URL("../../demo/three-day-program.json", import.meta.url), "utf8"));
    flowJson.schedule.dayFrame = { softFrom: 3, hardAt: 6, hardText: "Утром отвечу!" };
    const { judge } = fakeJudge();
    const flow = buildAgentFlow(
      { loadFlow: async () => ({ flowId: "three-day-program", versionId: "1", flow: flowJson }), store: memoryFlowStore(), judge: { fallback: MODEL }, logError: log },
      { judge },
    );
    const service = createChatService({
      storage,
      catalog: standardCatalog,
      defaultChoice: MODEL,
      env: process.env,
      logError: log,
      ...flow.withChat({ agent: { instructions: "Ты помощник автора онлайн-программ. Отвечай по-русски, коротко: два-три предложения." } }),
    });
    flow.attach(service);

    const chat = await service.createChat(OWNER);
    await service.setModel(OWNER, chat.id, { ...MODEL, reasoning: "off" });
    const turns: Array<{ turn: number; when: string; kind: string; day: number | null; state: string }> = [];
    for (const [index, step] of STEPS.entries()) {
      currentTurn = index + 1;
      vi.setSystemTime(step.at);
      if ("human" in step) {
        await drain(await service.sendMessage(OWNER, chat.id, { id: `h${index}`, role: "user", parts: [{ type: "text", text: step.human }] }, { page: { timeZone: MSK } }));
      } else {
        await flow.tick();
        await drain(await service.subscribe(OWNER, chat.id));
      }
      await Promise.all(pendingReads);
      await flow.settled();
      const run = await flow.readRun(OWNER, chat.id);
      turns.push({
        turn: currentTurn,
        when: new Date(step.at).toISOString(),
        kind: "human" in step ? "человек" : "таймер",
        day: run?.day?.day ?? null,
        state: run?.state ?? "?",
      });
    }

    const rows = turns.map((turn) => {
      const own = calls.filter((call) => call.turn === turn.turn);
      return { ...turn, requests: own.length, input: own.map((call) => call.promptTokens ?? null), cached: own.map((call) => call.cachedTokens ?? null) };
    });
    const systems = [...new Set(calls.map((call) => call.system))];
    const cacheMisses = journal.filter((line) => line.includes("[промах кэша]"));
    const spent = (await storage.sumUsage({ ownerId: OWNER, chatId: chat.id })).reduce((sum, entry) => sum + entry.costUsd, 0);
    const end = await flow.readRun(OWNER, chat.id);
    report("turns", rows);
    report("systems", systems);
    report("misses", cacheMisses);
    report("spent", { usd: spent, requests: calls.length });
    report("end", { state: end?.state, endReason: end?.endReason });

    const modelTurns = rows.filter((row) => row.requests > 0);
    expect(modelTurns.length).toBeGreaterThanOrEqual(10);
    expect(systems).toHaveLength(1);
    expect(cacheMisses).toEqual([]);
    // Жёсткая рамка и ночь — без модели; срок вышел — без модели.
    expect(rows[5]!.requests).toBe(0);
    expect(rows[6]!.requests).toBe(0);
    expect(rows.at(-1)!.requests).toBe(0);
    expect(end?.endReason).toBe("deadline");
    // Каждый ход модели, начиная со второго, читает из кэша почти весь последний запрос прошлого хода.
    for (let index = 1; index < modelTurns.length; index += 1) {
      const first = calls.find((call) => call.turn === modelTurns[index]!.turn)!;
      const previousLast = calls.filter((call) => call.turn === modelTurns[index - 1]!.turn).at(-1)!;
      expect(first.cachedTokens!).toBeGreaterThan(previousLast.promptTokens! * 0.8);
    }
  }, 600_000);
});
