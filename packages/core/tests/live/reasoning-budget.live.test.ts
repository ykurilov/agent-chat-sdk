// Живая проверка бюджета рассуждений (056): Claude Haiku 5.5 через OpenRouter на уровне «Максимум» (standardCatalog,
// настоящий createChatService). Трудная задача на точный счёт, на которой модель думает долго (проба: на `high` с потолком 8 000 все
// 8 000 ушли на рассуждения), с записью результата инструментом: в запросе потолок вывода профиля (`max_tokens`
// 128 000) и сила `high`, а не `xhigh` (запас на ответ); ответ не обрывается по длине, есть и рассуждения, и вызов
// инструмента, и текст. Платный: обычно $0,01–0,03, не больше $0,07 даже если модель выберет весь потолок. Ключ — только из окружения
// (`pnpm secrets:load`). Запуск: `pnpm test:live reasoning-budget`. Итог печатается строкой `[reasoning-budget]`.
import { tool } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "claude-haiku-5.5";
const providerId = "openrouter";
const ownerId = "budget-tester";

interface RecordedCall {
  maxTokens?: unknown;
  reasoning?: unknown;
  finishReason?: string;
  outputTokens?: number;
  reasoningTokens?: number;
  cost?: number;
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;

/** Службе чата `fetch` не передать: на время теста подменяется глобальный. Пишет поля запроса и итог ответа. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string" || !String(input).includes("/chat/completions")) return originalFetch(input, init);
    const body = JSON.parse(init.body) as { max_tokens?: unknown; reasoning?: unknown };
    const call: RecordedCall = { maxTokens: body.max_tokens, reasoning: body.reasoning };
    calls.push(call);
    const response = await originalFetch(input, init);
    pendingReads.push(
      response
        .clone()
        .text()
        .then((text) => {
          for (const line of text.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              const parsed = JSON.parse(line.slice(5)) as {
                choices?: Array<{ finish_reason?: string | null }>;
                usage?: { completion_tokens: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number } };
              };
              const finish = parsed.choices?.[0]?.finish_reason;
              if (finish) call.finishReason = finish;
              if (parsed.usage) {
                call.outputTokens = parsed.usage.completion_tokens;
                call.reasoningTokens = parsed.usage.completion_tokens_details?.reasoning_tokens ?? 0;
                call.cost = parsed.usage.cost;
              }
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

describe("Claude Haiku 5.5 на «Максимуме»: рассуждения не съедают ответ", () => {
  it("долгая задача с записью результата инструментом", async () => {
    const saved: string[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId, providerId, reasoning: "max" },
      agent: {
        instructions: "Ты аккуратный математик. Результат работы сохраняешь инструментом save_file, потом коротко отвечаешь по-русски.",
        tools: {
          save_file: tool({
            description: "Сохранить файл с результатом.",
            inputSchema: z.object({ name: z.string(), content: z.string() }),
            execute: async ({ name, content }) => {
              saved.push(`${name}: ${content}`);
              return "Сохранено.";
            },
          }),
        },
      },
      env: process.env,
      logError: () => {},
    });
    const chat = await service.createChat(ownerId);
    await drain(
      await service.sendMessage(ownerId, chat.id, {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "text",
            text:
              "Сколько перестановок чисел 1, 2, …, 10, в которых никакие два соседних числа не отличаются на 1? " +
              "Нужно точное число: выведи рекуррентное соотношение, посчитай по нему для n = 1…10 и сверь малые n " +
              "перебором. Сдаваться нельзя — считай до конца. Сохрани таблицу значений в файл perms.md инструментом " +
              "save_file и ответь одним предложением.",
          },
        ],
      }),
    );
    await Promise.all(pendingReads);
    const { messages } = await service.getHistory(ownerId, chat.id);
    const answer = messages.at(-1)!;
    const answerText = answer.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    const reasoningParts = answer.parts.filter((part) => part.type === "reasoning").length;

    process.stdout.write(
      `[reasoning-budget] ${JSON.stringify({
        calls,
        saved: saved.map((file) => file.slice(0, 200)),
        reasoningParts,
        answerText: answerText.slice(0, 300),
        totalCost: calls.reduce((sum, call) => sum + (call.cost ?? 0), 0),
      })}\n`,
    );

    expect(calls.length, "ход — вызов инструмента и ответ").toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.maxTokens, "в запросе потолок вывода профиля").toBe(128_000);
      expect(call.reasoning, "«Максимум» — с запасом на ответ").toEqual({ effort: "high" });
      expect(call.finishReason, "ответ не оборван по длине").not.toBe("length");
    }
    expect(calls.reduce((sum, call) => sum + (call.reasoningTokens ?? 0), 0), "модель рассуждала").toBeGreaterThan(0);
    expect(saved.length, "файл сохранён инструментом").toBeGreaterThanOrEqual(1);
    expect(answerText.trim(), "после инструмента есть текст ответа").not.toBe("");
  }, 600_000);
});
