// Живая проверка метки кэша перед хвостом запроса (OpenRouter, Gemini 3.8 Flash: кэш читает по явной метке `cache_control`).
// Разговор из 4 ходов: длинная инструкция (около 3000 токенов) и блок памяти в хвосте последнего сообщения (около 1500
// токенов), который от хода к ходу немного меняется. Блока в начале следующего запроса уже нет, поэтому метка только на
// конце сообщения (старая расстановка) не находится, и кэш откатывается к инструкции. Новая расстановка ставит ещё метку
// на вопрос перед хвостом: на ходах 2–4 кэшируется и история.
// Три прогона (у каждого своя метка в начале инструкции, чтобы кэши не пересекались):
//   - калибровка: один запрос без блока памяти, из его размера выводится размер инструкции;
//   - новая расстановка: как в приложении;
//   - контроль: то же, но метка перед хвостом на лету вырезана из тела запроса, то есть метка только в конце сообщения.
// Тест платный (9 запросов на дешёвой модели с минимальными рассуждениями). Ключ — только из окружения (`pnpm secrets:load`).
// Запуск: `pnpm test:live openrouter-tail-cache`. Результат печатается строкой `[tail-cache-result]`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { LongTermMemory } from "../../src/memory/long-term-memory";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "gemini-3.8-flash";
const providerId = "openrouter";
const ownerId = "tail-cache-tester";
/** Ответы в два-три предложения: история растёт на сотню-другую токенов за ход, и её кэш заметен. */
const questions = [
  "Объясни в двух-трёх предложениях, зачем журналу нужна ротация записей.",
  "А теперь в двух-трёх предложениях: чем архив отличается от резервной копии?",
  "В двух-трёх предложениях: почему записи нельзя хранить вечно?",
  "В двух-трёх предложениях: кто отвечает за удаление записей по графику?",
];

/** Начало инструкции — метка прогона: у каждого прогона свой кэш, чужой не подмешивается. Метки одной длины. */
const instructionsFor = (runLabel: string) =>
  [
    `Метка прогона: ${runLabel}.`,
    "Ты аккуратный помощник в тестовом стенде. Отвечай по-русски, строго в два-три предложения.",
    "Справка по стенду (длинное вступление, как в настоящем приложении):",
    ...Array.from({ length: 150 }, (_, index) => `Пункт ${index + 1}. Стенд ведёт журнал номер ${index + 1}; записи журнала хранятся неделю, потом архивируются и удаляются по графику.`),
  ].join("\n");

/** Блок памяти около 1500 токенов; последняя строка от хода к ходу меняется. */
const memoryBlockFor = (call: number) =>
  [
    "Заметки о собеседнике (долгая память):",
    ...Array.from({ length: 45 }, (_, index) => `Заметка ${index + 1}. Собеседник ведёт стенд номер ${index + 1} и просит не путать архив с резервной копией.`),
    `Последняя запись: обновлено при обращении ${call}.`,
  ].join("\n");

interface RecordedCall {
  promptTokens: number | undefined;
  cachedTokens: number | undefined;
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;
/** Контроль: метки перед хвостом вырезаются из тела запроса — остаётся старая расстановка (метки в конце сообщения и на инструкции). */
let stripMarksBeforeTail = false;

/** Из блоков содержимого сообщения человека убирает `cache_control` у всех, кроме последнего. */
function withoutMarksBeforeTail(body: string): string {
  const json = JSON.parse(body) as { messages?: Array<{ role: string; content: unknown }> };
  for (const message of json.messages ?? []) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content.slice(0, -1) as Array<Record<string, unknown>>) delete block.cache_control;
  }
  return JSON.stringify(json);
}

/** Службе чата `fetch` не передать: на время теста подменяется глобальный. Пишет только числа расхода, ключ и тексты не пишутся. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") return originalFetch(input, init);
    const call: RecordedCall = { promptTokens: undefined, cachedTokens: undefined };
    calls.push(call);
    const response = await originalFetch(input, stripMarksBeforeTail ? { ...init, body: withoutMarksBeforeTail(init.body) } : init);
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

/** Разговор в новом чате; `withMemory` — блок памяти в хвосте последнего сообщения человека. Возвращает запросы разговора. */
async function conversation(runLabel: string, options: { withMemory: boolean; strip: boolean; turns: number }): Promise<RecordedCall[]> {
  stripMarksBeforeTail = options.strip;
  let snapshots = 0;
  const memory: LongTermMemory = {
    instructions: "",
    toolNames: [],
    tools: () => ({}),
    snapshot: async () => memoryBlockFor(++snapshots),
  };
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId, providerId },
    agent: { instructions: instructionsFor(runLabel) },
    ...(options.withMemory && { memory }),
    env: process.env,
    logError: () => {},
  });
  const chat = await service.createChat(ownerId);
  await service.setModel(ownerId, chat.id, { modelId, providerId, reasoning: "minimal" });
  const from = calls.length;
  for (const [index, text] of questions.slice(0, options.turns).entries()) {
    await drain(await service.sendMessage(ownerId, chat.id, { id: `u${index}-${runLabel}`, role: "user", parts: [{ type: "text", text }] }));
    await Promise.all(pendingReads);
  }
  return calls.slice(from);
}

const share = (list: RecordedCall[]) => {
  const prompt = list.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0);
  const cached = list.reduce((sum, call) => sum + (call.cachedTokens ?? 0), 0);
  return prompt === 0 ? 0 : Number((cached / prompt).toFixed(3));
};

describe("OpenRouter, Gemini: метка кэша перед хвостом запроса (блок памяти)", () => {
  it("на ходах 2–4 в кэше больше, чем одна инструкция: история тоже кэшируется; контроль со старой расстановкой для сравнения", async () => {
    const runId = Date.now().toString(36).padStart(9, "0").slice(-9);
    const calibration = await conversation(`cal-${runId}`, { withMemory: false, strip: false, turns: 1 });
    const placed = await conversation(`new-${runId}`, { withMemory: true, strip: false, turns: questions.length });
    const control = await conversation(`old-${runId}`, { withMemory: true, strip: true, turns: questions.length });

    // Размер инструкции: запрос калибровки — инструкция и один короткий вопрос.
    const instructionTokens = calibration[0]?.promptTokens ?? 0;
    const margin = 100;
    const summary = {
      modelId,
      requests: calls.length,
      instructionTokens,
      newPlacement: {
        promptTokens: placed.map((call) => call.promptTokens ?? null),
        cachedTokens: placed.map((call) => call.cachedTokens ?? null),
        cachedShareTurns2to4: share(placed.slice(1)),
      },
      oldPlacement: {
        promptTokens: control.map((call) => call.promptTokens ?? null),
        cachedTokens: control.map((call) => call.cachedTokens ?? null),
        cachedShareTurns2to4: share(control.slice(1)),
      },
    };
    process.stdout.write(`[tail-cache-result] ${JSON.stringify(summary)}\n`);

    expect(instructionTokens, "калибровка: размер инструкции больше порога кэша (1024)").toBeGreaterThan(1024);
    expect(placed).toHaveLength(questions.length);
    // История лежит после инструкции: на ходах 3 и 4 её хватает, чтобы кэш заметно превысил одну инструкцию.
    for (const turn of [2, 3]) {
      expect(placed[turn]?.cachedTokens ?? 0, `ход ${turn + 1}: прочитано из кэша больше, чем размер одной инструкции`).toBeGreaterThan(instructionTokens + margin);
    }
    expect(share(placed.slice(1)), "новая расстановка читает кэша не меньше старой").toBeGreaterThanOrEqual(share(control.slice(1)));
  }, 600_000);
});
