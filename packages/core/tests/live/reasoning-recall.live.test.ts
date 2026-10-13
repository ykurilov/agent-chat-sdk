// Живая проверка: модель не только принимает свои прошлые рассуждения, но и видит их на следующем ходе.
// Ход 1: модель загадывает число только в рассуждениях и в ответе его не называет. Ход 2 идёт тем же путём, что в приложении
// (служба чата → SQLite в файле → история из хранилища → `buildModelRequest`): «какое число ты загадал?». Контроль — тот же
// вопрос по той же истории, но с вырезанными рассуждениями и шифром (так `selectReasoningForModel` поступает с чужой моделью).
// Тест падает только от поломок нашей стороны: рассуждения или шифр не сохранились в хранилище, не ушли во второй запрос или
// ушли в запрос контроля. Вспомнила ли модель число и что ответил контроль — поведение модели: только печатается в отчёт.
// Ключ — только из окружения (`pnpm secrets:load`). Запуск: `pnpm test:live reasoning-recall`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUIMessageStream, streamText } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildModelRequest } from "../../src/agent-run/build-model-request";
import { createChatService } from "../../src/chat-service";
import type { AgentChatMessage } from "../../src/conversation/types";
import { effectiveReasoningLevel } from "../../src/models/reasoning-level";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createSqliteChatStorage } from "../../../storage-sqlite/src/index";
import type { SqliteChatStorage } from "../../../storage-sqlite/src/index";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const providerId = "openrouter";
const modelIds = ["deepseek-4.1-flash", "glm-5.3-flash", "gpt-6-luna", "gemini-3.8-flash"];
/** Ход 1 повторяется, если модель проболталась: первая попытка и ещё две. */
const maxFirstTurnAttempts = 3;
const ownerId = "recall-tester";
const instructions = "Ты помощник. Отвечай по-русски, коротко.";
const firstQuestion =
  "Давай сыграем. Загадай про себя случайное трёхзначное число, но только в рассуждениях: в ответе его не называй и не намекай на него. Ответь одним словом: «Загадал».";
const secondQuestion = "Какое число ты загадал? Ответь только числом";
/**
 * Модели, чьё рассуждение без подписи провайдер OpenRouter вернуть не даёт: `@openrouter/ai-sdk-provider` выбрасывает из запроса
 * записи `reasoning.text` формата `google-gemini-v1` без подписи («missing signatures»). Google иногда подписи не присылает.
 */
const signatureRequired = new Set(["gemini-3.8-flash"]);

interface RecordedCall {
  body: string;
  /** Сырой ответ провайдера (поток SSE). */
  response: string;
  usage: ProviderUsage | undefined;
}

interface ProviderUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

const calls: RecordedCall[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;

/** Службе чата `fetch` не передать: на время теста подменяется глобальный, он записывает тело запроса и расход. Заголовки не пишутся. */
function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await originalFetch(input, init);
    if (typeof init?.body !== "string") return response;
    const call: RecordedCall = { body: init.body, response: "", usage: undefined };
    calls.push(call);
    const copy = response.clone();
    pendingReads.push(
      copy
        .text()
        .then((text) => {
          call.response = text;
          call.usage = readUsage(text);
        })
        .catch(() => {}),
    );
    return response;
  };
}

function readUsage(responseText: string): ProviderUsage | undefined {
  for (const line of responseText.split("\n").reverse()) {
    if (!line.startsWith("data:") || !line.includes('"usage"')) continue;
    try {
      const usage = (JSON.parse(line.slice(5)) as { usage?: ProviderUsage }).usage;
      if (usage) return usage;
    } catch {
      // неполная строка потока
    }
  }
  return undefined;
}

async function settledCalls(from: number): Promise<RecordedCall[]> {
  await Promise.all(pendingReads);
  return calls.slice(from);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { statusCode?: number; responseBody?: string };
    return `${error.name}${details.statusCode ? ` ${details.statusCode}` : ""}: ${error.message} ${details.responseBody?.slice(0, 300) ?? ""}`;
  }
  return String(error);
}

async function drain(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

function userMessage(id: string, text: string) {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text }] };
}

function textOf(message: AgentChatMessage | undefined): string {
  return (message?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("").trim();
}

function reasoningTexts(message: AgentChatMessage | undefined): string[] {
  return (message?.parts ?? []).flatMap((part) => (part.type === "reasoning" && part.text.trim().length > 0 ? [part.text] : []));
}

/** Шифр рассуждений GPT и подпись рассуждений Gemini, которые SDK прикладывает к частям ответа. */
function encryptedBlobs(message: AgentChatMessage | undefined): string[] {
  const found: string[] = [];
  for (const part of (message?.parts ?? []) as Array<Record<string, unknown>>) {
    for (const key of ["providerMetadata", "callProviderMetadata"]) {
      const details = (part[key] as { openrouter?: { reasoning_details?: Array<{ data?: string; signature?: string }> } } | undefined)
        ?.openrouter?.reasoning_details;
      for (const detail of details ?? []) {
        for (const secret of [detail.data, detail.signature]) if (typeof secret === "string" && secret.length > 20) found.push(secret);
      }
    }
  }
  return found;
}

const inBody = (body: string, piece: string) => body.includes(JSON.stringify(piece).slice(1, -1));
const threeDigitNumbers = (text: string) => [...text.matchAll(/(?<!\d)\d{3}(?!\d)/g)].map((match) => match[0]);

/** Самый сильный из обычных уровней (не «максимум»): рассуждения надёжнее видны. */
function levelFor(modelId: string): string | undefined {
  const profile = standardCatalog.models.find((model) => model.id === modelId)!;
  const levels = profile.reasoning.levels ?? [];
  return levels.includes("high") ? "high" : levels.includes("on") ? "on" : (effectiveReasoningLevel(profile) ?? undefined);
}

function costOf(modelId: string, usage: ProviderUsage | undefined): number {
  const price = standardCatalog.models.find((model) => model.id === modelId)!.pricing?.[providerId];
  if (!usage || !price) return 0;
  const input = usage.prompt_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  const cachedPrice = price.cachedInputPerMillion ?? price.inputPerMillion;
  return ((input - cached) * price.inputPerMillion + cached * cachedPrice + output * price.outputPerMillion) / 1_000_000;
}

/** Сообщения агента из тела запроса с длинными строками, сокращёнными до начала: для разбора, что ушло модели. */
function assistantSummary(body: string): unknown {
  const shorten = (value: unknown): unknown =>
    typeof value === "string"
      ? value.length > 100
        ? `${value.slice(0, 100)}… (${value.length} зн.)`
        : value
      : Array.isArray(value)
        ? value.map(shorten)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shorten(inner)]))
          : value;
  const messages = (JSON.parse(body) as { messages?: Array<{ role: string }> }).messages ?? [];
  return shorten(messages.filter((message) => message.role === "assistant"));
}

let directory: string;
let storage: SqliteChatStorage;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "reasoning-recall-"));
  storage = createSqliteChatStorage({ filePath: join(directory, "chat.sqlite") });
  globalThis.fetch = recordingFetch();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  storage.close();
  rmSync(directory, { recursive: true, force: true });
});

describe.each(modelIds)("вспоминает ли %s свои рассуждения (OpenRouter)", (modelId) => {
  it("рассуждения хода 1 сохраняются и уходят во второй запрос, в контроль — нет; вспомнила ли модель — в отчёт", async (context) => {
    const reasoning = levelFor(modelId);
    const service = createChatService({
      storage,
      catalog: standardCatalog,
      defaultChoice: { modelId, providerId },
      agent: { instructions },
      env: process.env,
    });
    const history = async (chatId: string) => (await service.getHistory(ownerId, chatId)).messages;
    const lastAnswer = async (chatId: string) => (await history(chatId)).findLast((message) => message.role === "assistant");

    // Ход 1: повторяется, пока число попадает в текст ответа. Если проболталась во всех попытках, проверки нашей стороны всё равно идут.
    let chatId = "";
    let firstAnswer: AgentChatMessage | undefined;
    let attempts = 0;
    let leaked = true;
    const firstTurnCalls: RecordedCall[] = [];
    for (; attempts < maxFirstTurnAttempts && leaked; attempts++) {
      const chat = await service.createChat(ownerId);
      await service.setModel(ownerId, chat.id, { modelId, providerId, ...(reasoning && { reasoning }) });
      const from = calls.length;
      await drain(await service.sendMessage(ownerId, chat.id, userMessage(`${modelId}-q1-${attempts}`, firstQuestion)));
      firstTurnCalls.push(...(await settledCalls(from)));
      chatId = chat.id;
      firstAnswer = await lastAnswer(chat.id);
      if (firstAnswer?.metadata?.status !== "complete") {
        throw new Error(`ход 1: ответ не завершён: ${JSON.stringify(firstAnswer?.metadata)}`);
      }
      leaked = threeDigitNumbers(textOf(firstAnswer)).length > 0;
    }

    // Рассуждения и шифр — то, что реально лежит в хранилище и читается обратно (не то, что пришло из потока).
    const stored = await history(chatId);
    const storedAnswer = stored.findLast((message) => message.role === "assistant");
    const reasoningParts = reasoningTexts(storedAnswer);
    const blobs = encryptedBlobs(storedAnswer);
    const candidates = [...new Set(reasoningParts.flatMap(threeDigitNumbers))].filter((number) => number !== "100" && number !== "999");
    const result = {
      modelId,
      level: reasoning ?? null,
      firstTurnAttempts: attempts,
      leaked,
      firstAnswer: textOf(storedAnswer),
      reasoningParts: reasoningParts.length,
      reasoningChars: reasoningParts.reduce((sum, part) => sum + part.length, 0),
      encryptedBlobs: blobs.length,
      candidates,
    };
    // Google прислал рассуждение без подписи: сохранять и возвращать нечего, провайдер OpenRouter такое из запроса выбрасывает.
    const providerSentSignature = /"signature":"[^"]{20,}/.test(firstTurnCalls.at(-1)?.response ?? "");
    if (signatureRequired.has(modelId) && !providerSentSignature) {
      const reason = `${modelId}: провайдер прислал рассуждение без подписи, вернуть его модели нельзя — проверка пропущена`;
      console.log("[recall-result]", JSON.stringify({ ...result, verdict: reason }));
      context.skip(reason);
    }

    // Ход 2: через службу чата, как в приложении. Вторая независимая переделка того же хода нужна, когда рассуждение зашифровано.
    const secondFrom = calls.length;
    await drain(await service.sendMessage(ownerId, chatId, userMessage(`${modelId}-q2`, secondQuestion)));
    const secondRunA = await lastAnswer(chatId);
    const secondCallsA = await settledCalls(secondFrom);
    const rerunFrom = calls.length;
    await drain(await service.regenerate(ownerId, chatId, secondRunA!.id));
    const secondRunB = await lastAnswer(chatId);
    const secondCallsB = await settledCalls(rerunFrom);
    expect(secondRunA?.id).not.toBe(secondRunB?.id);

    // Контроль: та же история до вопроса 2, но ответ хода 1 «от другой модели»: рассуждения и шифр вырезаются.
    const foreignHistory: AgentChatMessage[] = [
      ...stored.map((message) =>
        message.role === "assistant" ? { ...message, metadata: { ...message.metadata, modelId: "other-model", providerId: "other" } } : message,
      ),
      userMessage(`${modelId}-q2-control`, secondQuestion),
    ];
    const controlFrom = calls.length;
    const controlErrors: string[] = [];
    const controlRequest = await buildModelRequest({
      catalog: standardCatalog,
      modelId,
      providerId,
      ...(reasoning && { reasoning }),
      chatId,
      instructions,
      history: foreignHistory,
      env: process.env,
    });
    const controlStream = streamText({ ...controlRequest, maxRetries: 0, onError: ({ error }) => void controlErrors.push(describeError(error)) });
    let controlMessage: AgentChatMessage | undefined;
    for await (const message of readUIMessageStream<AgentChatMessage>({
      stream: controlStream.toUIMessageStream<AgentChatMessage>({ sendReasoning: true }),
    })) {
      controlMessage = message;
    }
    const controlCalls = await settledCalls(controlFrom);
    expect(controlErrors).toEqual([]);

    const pieces = [...reasoningParts, ...blobs];
    const mainBody = secondCallsA[0]?.body ?? "";
    const controlBody = controlCalls[0]?.body ?? "";
    const answerA = textOf(secondRunA);
    const answerB = textOf(secondRunB);
    const answerControl = textOf(controlMessage);
    const numberA = threeDigitNumbers(answerA)[0];
    const numberB = threeDigitNumbers(answerB)[0];
    const numberControl = threeDigitNumbers(answerControl)[0];
    const readable = candidates.length > 0;
    const recalled = !leaked && numberA !== undefined && (readable ? candidates.includes(numberA) : numberA === numberB);
    const controlIgnorant = numberControl === undefined || (readable ? !candidates.includes(numberControl) : numberControl !== numberA);

    const allCalls = [...firstTurnCalls, ...secondCallsA, ...secondCallsB, ...controlCalls];
    const costUsd = allCalls.reduce((sum, call) => sum + costOf(modelId, call.usage), 0);
    const facts = {
      ...result,
      secondAnswer: answerA,
      secondAnswerRerun: answerB,
      controlAnswer: answerControl,
      secondReasoningExcerpt: reasoningTexts(secondRunA).join(" ").slice(0, 400),
      readableReasoning: readable,
      requestCarriesReasoning: pieces.filter((piece) => inBody(mainBody, piece)).length,
      requestCarriesReasoningOutOf: pieces.length,
      controlRequestCarriesReasoning: pieces.filter((piece) => inBody(controlBody, piece)).length,
      recalled,
      controlIgnorant,
      requests: allCalls.length,
      reasoningTokensFirstTurn: firstTurnCalls.at(-1)?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      usage: allCalls.map((call) => call.usage ?? null),
      costUsd: Number(costUsd.toFixed(6)),
      providerCostUsd: Number(allCalls.reduce((sum, call) => sum + (call.usage?.cost ?? 0), 0).toFixed(6)),
    };
    console.log("[recall-result]", JSON.stringify(facts));
    const verdict = leaked
      ? "модель проболталась на ходе 1, вспоминание не оценить"
      : `${recalled ? "вспомнила" : "не вспомнила"}: ход 2 «${answerA}» / «${answerB}», в рассуждениях: ${candidates.join(", ") || "текста нет"}; контроль «${answerControl}»${controlIgnorant ? "" : " — то же число без рассуждений, совпадение не доказывает память"}`;
    console.log(`[recall-verdict] ${modelId}: ${verdict}`);
    if (!recalled || !controlIgnorant) {
      console.log("[recall-bodies] ход 2, сообщения агента в запросе:", JSON.stringify(assistantSummary(mainBody)));
      console.log("[recall-bodies] контроль, сообщения агента в запросе:", JSON.stringify(assistantSummary(controlBody)));
    }

    expect(pieces.length, "после хода 1 в хранилище нет ни рассуждений, ни шифра").toBeGreaterThan(0);
    expect(facts.requestCarriesReasoning, "рассуждения из хранилища ушли во второй запрос").toBe(pieces.length);
    expect(facts.controlRequestCarriesReasoning, "в запросе контроля рассуждений быть не должно").toBe(0);
  }, 300_000);
});
