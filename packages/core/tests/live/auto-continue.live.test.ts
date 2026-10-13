// Живая проверка автопродолжения (US7, SC-010): настоящая модель (OpenRouter, Gemini 3.8 Flash) обёрнута подменой,
// которая в первом запросе рвёт поток ошибкой перегрузки (503) после первого куска текста. Ядро ждёт около 2 с и
// продолжает тот же ответ: модель видит написанное и пометку о сбое и дописывает, а не начинает заново.
// Ответ — нумерованный список «N — N²» из 20 строк: повтор начала виден по второй строке «1 — 1».
// Тест платный (2 запроса на дешёвой модели с минимальными рассуждениями). Ключ — только из окружения (`pnpm secrets:load`).
// Запуск: `pnpm test:live auto-continue`. Результат печатается строкой `[auto-continue-result]`.
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, wrapLanguageModel } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { StoredMessage } from "../../src/conversation/types";
import type { ModelCatalog } from "../../src/models/model-catalog";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "gemini-3.8-flash";
const providerId = "openrouter";
const ownerId = "auto-continue-tester";
const question =
  "Выпиши нумерованный список из 20 строк: в строке N — число N, длинное тире и квадрат N, например «3 — 9». Каждая строка с новой строки, без вступления и без заключения.";

let streamCalls = 0;
/** Текст первой попытки до обрыва: продолжение должно стоять сразу после него. */
let textBeforeCut = "";

/** Первый запрос: куски проходят до первого куска текста включительно, затем ошибка 503 и обрыв. Остальные — как есть. */
function cutFirstStream(model: LanguageModelV4): LanguageModelV4 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      async wrapStream({ doStream }) {
        const result = await doStream();
        if (++streamCalls > 1) return result;
        const reader = result.stream.getReader();
        const stream = new ReadableStream<LanguageModelV4StreamPart>({
          async pull(controller) {
            const read = await reader.read();
            if (read.done) return controller.close();
            controller.enqueue(read.value);
            if (read.value.type !== "text-delta") return;
            textBeforeCut += read.value.delta;
            controller.enqueue({
              type: "error",
              error: new APICallError({ message: "Simulated overload", url: "https://live.invalid/cut", requestBodyValues: {}, statusCode: 503, isRetryable: true }),
            });
            controller.close();
            void reader.cancel().catch(() => {});
          },
          cancel(reason) {
            void reader.cancel(reason).catch(() => {});
          },
        });
        return { ...result, stream };
      },
    },
  });
}

const catalog: ModelCatalog = {
  ...standardCatalog,
  providers: standardCatalog.providers.map((provider) =>
    provider.id === providerId
      ? { ...provider, createLanguageModel: (...args) => cutFirstStream(provider.createLanguageModel(...args) as LanguageModelV4) }
      : provider,
  ),
};

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) chunks.push(read.value);
  return chunks;
}

const textOf = (parts: StoredMessage["parts"]) => parts.map((part) => (part.type === "text" ? part.text : "")).join("");

describe("OpenRouter, Gemini: автопродолжение после обрыва посреди ответа", () => {
  it("ответ дописан в том же сообщении, начало не повторяется, ошибки клиент не видит", async () => {
    const logged: string[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog,
      defaultChoice: { modelId, providerId },
      agent: { instructions: "Ты аккуратный помощник. Отвечай по-русски, строго по заданию." },
      env: process.env,
      logError: (line) => logged.push(line),
    });
    const chat = await service.createChat(ownerId);
    await service.setModel(ownerId, chat.id, { modelId, providerId, reasoning: "minimal" });

    const chunks = await readAll(await service.sendMessage(ownerId, chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: question }] }));
    const answer = (await service.getHistory(ownerId, chat.id)).messages.at(-1)!;
    const text = textOf(answer.parts);
    const firstLines = text.match(/(^|\n)\s*1\.?\s*[—–-]\s*1(?!\d)/g) ?? [];
    process.stdout.write(
      `[auto-continue-result] ${JSON.stringify({ modelId, streamCalls, status: answer.metadata?.status, textBeforeCut, text, autoContinueLines: logged.filter((line) => line.startsWith("[автопродолжение]")) })}\n`,
    );

    expect(streamCalls, "оборванный запрос и одно продолжение").toBe(2);
    expect(logged.filter((line) => line.startsWith("[автопродолжение]"))).toHaveLength(1);
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(answer.metadata?.status).toBe("complete");
    expect(textBeforeCut.length).toBeGreaterThan(0);
    expect(text.startsWith(textBeforeCut), "написанное до обрыва осталось началом ответа").toBe(true);
    expect(text.length).toBeGreaterThan(textBeforeCut.length);
    expect(firstLines, "ответ не начат заново: строка «1 — 1» одна").toHaveLength(1);
    expect(text).toMatch(/20\.?\s*[—–-]\s*400/);
  }, 120_000);
});
