// Живой замер метки кэша на шагах одного хода (OpenRouter, Gemini 3.8 Flash). Вопрос аудита: стоит ли на каждом шаге
// ставить метку `cache_control` на последнее сообщение, чтобы кэшировались и результаты инструментов прошлых шагов.
// Ход из 4 шагов: модель читает документ по частям инструментом `read_part`, каждая часть — около 20 тысяч знаков и в конце
// называет следующую, так что части идут по одной на шаг. Три прогона (у каждого своя метка в начале инструкции, кэши не
// пересекаются):
//   - «strip»: меток на сообщениях-результатах нет — как в приложении;
//   - «message»: метка на последнем сообщении-результате (так её передал бы провайдер SDK из метки сообщения);
//   - «block»: метка внутри содержимого последнего результата.
// Замер 2026-10-02: во всех трёх шаги 2 и 3 из кэша не читают, шаг 4 читает ~16,3 тыс. токенов (кэш Gemini сам по себе);
// выгоды от метки шага нет, поэтому приложение её не ставит. Тест — замер: проверяет только, что ход многошаговый.
// Тест платный (12 запросов на дешёвой модели с минимальными рассуждениями, около $0,12). Ключ — только из окружения
// (`pnpm secrets:load`). Запуск: `pnpm test:live openrouter-step-cache`. Результат печатается строкой `[step-cache-result]`.
import { tool } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "gemini-3.8-flash";
const providerId = "openrouter";
const ownerId = "step-cache-tester";
const parts = 3;

const instructionsFor = (runLabel: string) =>
  [
    `Метка прогона: ${runLabel}.`,
    "Ты аккуратный помощник в тестовом стенде. Документы читаешь только инструментом read_part, по одной части за шаг.",
    "Справка по стенду:",
    ...Array.from({ length: 30 }, (_, index) => `Пункт ${index + 1}. Стенд хранит документ номер ${index + 1} частями; части читаются строго по порядку.`),
  ].join("\n");

/** Часть документа около 20 тысяч знаков; в конце — какую часть читать дальше. Текст свой у каждого прогона и части. */
const partText = (runLabel: string, number: number) =>
  [
    `Документ прогона ${runLabel}, часть ${number} из ${parts}.`,
    ...Array.from(
      { length: 220 },
      (_, index) => `Строка ${number}.${index + 1}: склад ${runLabel} принял партию ${number * 1000 + index} ящиков и отметил её в журнале приёмки.`,
    ),
    number < parts ? `Конец части ${number}. Дальше прочитай часть ${number + 1}.` : `Конец части ${number}, она последняя. Ответь одним словом: «готово».`,
  ].join("\n");

interface RecordedCall {
  promptTokens: number | undefined;
  cachedTokens: number | undefined;
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;
let stepMark: "strip" | "message" | "block" = "strip";

/** Метка на сообщениях-результатах: «strip» — вырезать все, «message» и «block» — поставить на последнее. */
function withStepMark(body: string): string {
  const json = JSON.parse(body) as { messages?: Array<Record<string, unknown>> };
  const messages = json.messages ?? [];
  for (const message of messages) if (message.role === "tool" && stepMark === "strip") delete message.cache_control;
  const last = messages.at(-1);
  if (stepMark === "message" && last?.role === "tool" && !last.cache_control) last.cache_control = { type: "ephemeral" };
  if (stepMark === "block" && last?.role === "tool" && typeof last.content === "string") {
    delete last.cache_control;
    last.content = [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }];
  }
  return JSON.stringify(json);
}

/** Службе чата `fetch` не передать: на время теста подменяется глобальный. Пишет только числа расхода. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string" || !String(input).includes("/chat/completions")) return originalFetch(input, init);
    const call: RecordedCall = { promptTokens: undefined, cachedTokens: undefined };
    calls.push(call);
    const response = await originalFetch(input, { ...init, body: withStepMark(init.body) });
    const copy = response.clone();
    pendingReads.push(
      copy
        .text()
        .then((text) => {
          for (const line of text.split("\n").reverse()) {
            if (!line.startsWith("data:") || !line.includes('"usage"')) continue;
            try {
              const usage = (JSON.parse(line.slice(5)) as { usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;
              if (!usage) continue;
              call.promptTokens = usage.prompt_tokens;
              call.cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
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

/** Один ход в новом чате: модель читает части по одной. Возвращает запросы хода. */
async function readingTurn(runLabel: string, mark: typeof stepMark): Promise<RecordedCall[]> {
  stepMark = mark;
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId, providerId },
    agent: {
      instructions: instructionsFor(runLabel),
      tools: {
        read_part: tool({
          description: "Читает часть документа по номеру.",
          inputSchema: z.object({ number: z.number().int().min(1).max(parts) }),
          execute: async ({ number }) => partText(runLabel, number),
        }),
      },
    },
    env: process.env,
    logError: () => {},
  });
  const chat = await service.createChat(ownerId);
  await service.setModel(ownerId, chat.id, { modelId, providerId, reasoning: "minimal" });
  const from = calls.length;
  const text = "Прочитай документ, начиная с части 1, и следуй указанию в конце каждой части.";
  await drain(await service.sendMessage(ownerId, chat.id, { id: `u-${runLabel}`, role: "user", parts: [{ type: "text", text }] }));
  await Promise.all(pendingReads);
  return calls.slice(from);
}

const cachedShare = (list: RecordedCall[]) => {
  const prompt = list.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0);
  const cached = list.reduce((sum, call) => sum + (call.cachedTokens ?? 0), 0);
  return prompt === 0 ? 0 : Number((cached / prompt).toFixed(3));
};

describe("OpenRouter, Gemini: метка кэша на шагах длинного хода", () => {
  it("замер: сколько входа шагов 2–4 читается из кэша без метки шага и с ней", async () => {
    const runId = Date.now().toString(36).padStart(9, "0").slice(-9);
    const runs = {
      strip: await readingTurn(`str-${runId}`, "strip"),
      message: await readingTurn(`msg-${runId}`, "message"),
      block: await readingTurn(`blk-${runId}`, "block"),
    };
    const view = (list: RecordedCall[]) => ({
      promptTokens: list.map((call) => call.promptTokens ?? null),
      cachedTokens: list.map((call) => call.cachedTokens ?? null),
      cachedShareSteps2to4: cachedShare(list.slice(1)),
    });
    const summary = Object.fromEntries(Object.entries(runs).map(([mark, list]) => [mark, view(list)]));
    process.stdout.write(`[step-cache-result] ${JSON.stringify({ modelId, ...summary })}\n`);

    for (const list of Object.values(runs)) expect(list.length, "ход из нескольких шагов").toBeGreaterThanOrEqual(3);
  }, 600_000);
});
