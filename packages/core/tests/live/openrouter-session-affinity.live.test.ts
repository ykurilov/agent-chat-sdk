// Живая проверка привязки чата к одному серверу OpenRouter (x-session-id) и журнала промахов кэша.
// Один и тот же длинный разговор идёт дважды на модели с автокэшем (GPT 6 Luna): с заголовком `x-session-id` (как в
// приложении) и без него (контроль: заголовок вырезан на время теста). Сравнивается доля входа, прочитанная из кэша на ходах 2–4.
// Тест платный (около 8 запросов на дешёвой модели) и не дешёвый по времени. Ключ — только из окружения (`pnpm secrets:load`).
// Запуск: `pnpm test:live openrouter-session-affinity`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "gpt-6-luna";
const providerId = "openrouter";
const ownerId = "affinity-tester";
const questions = ["Сколько будет 2 + 2? Ответь одним числом.", "А 3 + 4?", "А 10 − 6?", "А 7 + 8?"];
/** Длинное начало запроса: провайдеры кэшируют только начало длиннее 1024 токенов. */
const instructions = [
  "Ты аккуратный помощник в тестовом стенде. Отвечай по-русски, одним числом, без пояснений.",
  "Справка по стенду (длинное вступление, как в настоящем приложении):",
  ...Array.from({ length: 120 }, (_, index) => `Пункт ${index + 1}. Стенд ведёт журнал номер ${index + 1}; записи журнала хранятся неделю, потом архивируются и удаляются по графику.`),
].join("\n");

interface RecordedCall {
  sessionId: string | null;
  promptTokens: number | undefined;
  cachedTokens: number | undefined;
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;
let stripSessionId = false;

/** Службе чата `fetch` не передать: на время теста подменяется глобальный. Пишет только номер сессии и числа расхода, ключ не пишется. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") return originalFetch(input, init);
    const headers = new Headers(init.headers);
    const call: RecordedCall = { sessionId: headers.get("x-session-id"), promptTokens: undefined, cachedTokens: undefined };
    if (stripSessionId) headers.delete("x-session-id");
    calls.push(call);
    const response = await originalFetch(input, { ...init, headers });
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

const cachedShare = (list: RecordedCall[]) => {
  const prompt = list.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0);
  const cached = list.reduce((sum, call) => sum + (call.cachedTokens ?? 0), 0);
  return prompt === 0 ? 0 : cached / prompt;
};

beforeAll(() => {
  globalThis.fetch = recordingFetch();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

/** Разговор из четырёх вопросов в новом чате; возвращает запросы разговора, номер чата и строки `[промах кэша]`. */
async function conversation(strip: boolean) {
  stripSessionId = strip;
  const logged: string[] = [];
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId, providerId },
    agent: { instructions },
    env: process.env,
    logError: (line) => logged.push(line),
  });
  const chat = await service.createChat(ownerId);
  await service.setModel(ownerId, chat.id, { modelId, providerId, reasoning: "off" });
  const from = calls.length;
  for (const [index, text] of questions.entries()) {
    await drain(await service.sendMessage(ownerId, chat.id, { id: `u${index}-${strip}`, role: "user", parts: [{ type: "text", text }] }));
    await Promise.all(pendingReads);
  }
  return { chatId: chat.id, requests: calls.slice(from), misses: logged.filter((line) => line.startsWith("[промах кэша]")) };
}

describe("OpenRouter: привязка чата к одному серверу (x-session-id)", () => {
  it("заголовок уходит на каждом запросе, и кэш на ходах 2–4 читается; контроль без заголовка для сравнения", async () => {
    const bound = await conversation(false);
    const control = await conversation(true);
    const result = {
      modelId,
      boundRequests: bound.requests.length,
      boundSessionIdsOk: bound.requests.every((call) => call.sessionId === bound.chatId),
      boundCachedShareTurns2to4: Number(cachedShare(bound.requests.slice(1)).toFixed(3)),
      boundMissLines: bound.misses,
      controlRequests: control.requests.length,
      controlCachedShareTurns2to4: Number(cachedShare(control.requests.slice(1)).toFixed(3)),
      controlMissLines: control.misses,
      usage: bound.requests.map((call) => [call.promptTokens, call.cachedTokens]),
    };
    console.log("[affinity-result]", JSON.stringify(result));

    expect(bound.requests).toHaveLength(questions.length);
    expect(result.boundSessionIdsOk, "x-session-id равен номеру чата на каждом запросе").toBe(true);
    expect(result.boundCachedShareTurns2to4, "со вторым ходом кэш должен читаться").toBeGreaterThan(0.3);
  }, 300_000);
});
