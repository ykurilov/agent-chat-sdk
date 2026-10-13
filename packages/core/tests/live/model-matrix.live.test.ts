// Живая проверка каждой пары «модель × провайдер» стандартного набора (FR-026, SC-003, SC-004):
// три хода в одном чате с двумя вызовами инструмента подряд, рассуждения возвращаются и уходят обратно,
// второй ход читает кэш. Ключи — только из окружения. Запуск: `pnpm test:live model-matrix`.
import { readUIMessageStream, stepCountIs, streamText, tool } from "ai";
import type { StepResult, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildModelRequest } from "../../src/agent-run/build-model-request";
import type { AgentChatMessage } from "../../src/conversation/types";
import { effectiveReasoningLevel } from "../../src/models/reasoning-level";
import { standardCatalog } from "../../src/models/standard-catalog";

const turnsPerPair = 3;

const pairs = standardCatalog.models.flatMap((model) =>
  Object.keys(model.providerModelIds).map((providerId) => ({ modelId: model.id, providerId })),
);

const instructions = [
  "Ты аккуратный помощник-вычислитель в тестовом стенде модуля чата.",
  "Правила работы:",
  "1. Любое сложение делай только инструментом add. Не складывай в уме, даже если числа простые.",
  "2. Если нужно несколько сложений подряд, вызывай add по очереди: следующий вызов — после результата предыдущего.",
  "3. Не придумывай результаты инструментов и не пропускай шаги.",
  "4. Итоговый ответ — одно число без пояснений, если собеседник не просит иного.",
  "5. Отвечай по-русски.",
  "",
  "Справка по стенду (длинное вступление, как в настоящем приложении: провайдеры кэшируют только достаточно длинное начало запроса):",
  ...Array.from(
    { length: 40 },
    (_, index) =>
      `Пункт ${index + 1}. Стенд проверяет работу модели в чате: вызов инструментов по очереди, возврат рассуждений между шагами и ходами, чтение кэша начала запроса. Результаты сравниваются с ожидаемыми числами, поэтому ответ должен быть точным и без лишних слов.`,
  ),
].join("\n");

const tools = {
  add: tool({
    description: "Складывает два числа и возвращает сумму.",
    inputSchema: z.object({ a: z.number().describe("Первое слагаемое"), b: z.number().describe("Второе слагаемое") }),
    execute: async ({ a, b }) => a + b,
  }),
} satisfies ToolSet;

// Задачи, где перед вызовом инструмента надо подумать (какие числа складывать и в каком порядке): без этого
// модель вызывает инструмент, не рассуждая, и проверять возврат рассуждений не на чем.
const questions = [
  "У Пети 17 яблок, у Маши на 8 яблок больше, а у Коли столько, сколько у Пети и Маши вместе, минус 34. Сколько яблок у всех троих? Сложения — инструментом add. Ответь числом.",
  "Ответь числом. К последнему результату прибавь удвоенное число дней в неделе, а потом число месяцев в году минус 4. Каждое сложение — инструментом add.",
  "Ответь числом. К последнему результату прибавь утроенное число дней в неделе, а потом число углов у треугольника. Каждое сложение — инструментом add.",
];
const expectedAnswers = ["50", "72", "96"];

/** Самый сильный уровень из обычных (не «максимум»): рассуждения надёжнее видны. */
function levelFor(modelId: string): string | undefined {
  const profile = standardCatalog.models.find((model) => model.id === modelId)!;
  const levels = profile.reasoning.levels ?? [];
  return levels.includes("high") ? "high" : levels.includes("on") ? "on" : (effectiveReasoningLevel(profile) ?? undefined);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { statusCode?: number; responseBody?: string };
    const body = details.responseBody ? ` ${details.responseBody.slice(0, 500)}` : "";
    return `${error.name}${details.statusCode ? ` ${details.statusCode}` : ""}: ${error.message}${body}`;
  }
  return String(error);
}

/** Шифр и прочие метаданные провайдера, которые SDK прикладывает к частям ответа. */
function providerSecrets(message: AgentChatMessage): string[] {
  const found: string[] = [];
  for (const part of message.parts as Array<Record<string, unknown>>) {
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

function reasoningTexts(message: AgentChatMessage): string[] {
  return message.parts.flatMap((part) => (part.type === "reasoning" && part.text.trim().length > 20 ? [part.text] : []));
}

interface TurnFacts {
  turn: number;
  errors: string[];
  text: string;
  addCalls: number;
  reasoningParts: number;
  encryptedBlobs: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  replayedEarlierReasoning: boolean;
}

describe.each(pairs)("живая проверка пары: $modelId × $providerId", ({ modelId, providerId }) => {
  it(`${turnsPerPair} хода в одном чате: инструменты, рассуждения, кэш`, async () => {
    const chatId = `live-matrix-${modelId}-${providerId}-${Date.now()}`;
    const reasoning = levelFor(modelId);
    const history: AgentChatMessage[] = [];
    const facts: TurnFacts[] = [];
    const answers: AgentChatMessage[] = [];

    for (let turn = 0; turn < turnsPerPair; turn++) {
      history.push({ id: `u${turn}`, role: "user", parts: [{ type: "text", text: questions[turn]! }] });
      const bodies: string[] = [];
      const errors: string[] = [];
      const recordingFetch: typeof globalThis.fetch = async (input, init) => {
        if (typeof init?.body === "string") bodies.push(init.body);
        return globalThis.fetch(input, init);
      };
      const request = await buildModelRequest({
        catalog: standardCatalog,
        modelId,
        providerId,
        reasoning,
        chatId,
        instructions,
        tools,
        history,
        env: process.env,
        fetch: recordingFetch,
      });
      const result = streamText({
        ...request,
        stopWhen: stepCountIs(6),
        maxRetries: 0,
        onError: ({ error }) => void errors.push(describeError(error)),
      });
      let answer: AgentChatMessage | undefined;
      for await (const message of readUIMessageStream<AgentChatMessage>({
        stream: result.toUIMessageStream<AgentChatMessage>({ sendReasoning: true }),
      })) {
        answer = message;
      }
      const [text, steps, totalUsage] = await Promise.all([
        Promise.resolve(result.text).catch(() => ""),
        Promise.resolve(result.steps).catch((): StepResult<ToolSet>[] => []),
        Promise.resolve(result.totalUsage).catch(() => undefined),
      ]);

      // Рассуждения и шифр прошлых ходов той же пары должны быть в теле первого запроса этого хода.
      const earlier = answers.flatMap((previous) => [
        ...reasoningTexts(previous).map((piece) => ({ kind: "текст", piece })),
        ...providerSecrets(previous).map((piece) => ({ kind: "шифр", piece })),
      ]);
      const firstBody = bodies[0] ?? "";
      const missing = earlier.filter(({ piece }) => !firstBody.includes(JSON.stringify(piece).slice(1, -1)));
      const replayed = missing.length === 0;
      if (!replayed) console.log(`ход ${turn + 1}: не ушло обратно`, JSON.stringify(missing.map(({ kind, piece }) => ({ kind, length: piece.length }))), "из", earlier.length);

      const complete: AgentChatMessage = {
        ...(answer ?? { id: `a${turn}`, role: "assistant", parts: [] }),
        metadata: { modelId, providerId, status: "complete" },
      };
      answers.push(complete);
      history.push(complete);
      facts.push({
        turn: turn + 1,
        errors,
        text: text.trim().slice(0, 60),
        addCalls: steps.flatMap((step) => step.toolCalls).filter((call) => call.toolName === "add").length,
        reasoningParts: reasoningTexts(complete).length,
        encryptedBlobs: providerSecrets(complete).length,
        reasoningTokens: totalUsage?.outputTokenDetails?.reasoningTokens ?? 0,
        cacheReadTokens: totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0,
        inputTokens: totalUsage?.inputTokens ?? 0,
        replayedEarlierReasoning: replayed,
      });
    }
    console.log(`[${modelId} × ${providerId}, уровень ${reasoning ?? "—"}]`, JSON.stringify(facts));

    for (const fact of facts) {
      expect(fact.errors, `ход ${fact.turn}: ошибка провайдера`).toEqual([]);
      expect(fact.addCalls, `ход ${fact.turn}: вызовов add`).toBeGreaterThanOrEqual(2);
      expect(fact.text, `ход ${fact.turn}: ответ`).toContain(expectedAnswers[fact.turn - 1]);
      expect(fact.replayedEarlierReasoning, `ход ${fact.turn}: рассуждения прошлых ходов уходят обратно`).toBe(true);
    }
    // Модель иногда отвечает без рассуждения: важно, что за три хода оно было и сохранено.
    const profile = standardCatalog.models.find((model) => model.id === modelId)!;
    const sawReasoning = facts.some((fact) => fact.reasoningParts > 0 || fact.encryptedBlobs > 0 || fact.reasoningTokens > 0);
    expect(sawReasoning, "за три хода нет ни рассуждений, ни шифра, ни токенов рассуждений").toBe(true);
    if (profile.reasoning.encrypted) {
      expect(facts.some((fact) => fact.encryptedBlobs > 0), "шифр рассуждений сохранён в частях ответа").toBe(true);
    }
    expect(facts[1]!.cacheReadTokens, "второй ход читает кэш").toBeGreaterThan(0);
  }, 300_000);
});

// Смена модели посреди чата (FR-011, SC-005): DeepSeek → GPT 6 Luna → снова DeepSeek, всё через OpenRouter.
// Рассуждения и шифр одной модели не уходят другой, своей модели они возвращаются.
describe("живая проверка смены модели посреди чата", () => {
  const route = [
    { modelId: "deepseek-4.1-flash", providerId: "openrouter", reasoning: "on" },
    { modelId: "gpt-6-luna", providerId: "openrouter", reasoning: "medium" },
    { modelId: "deepseek-4.1-flash", providerId: "openrouter", reasoning: "on" },
  ];

  it("три хода на разных моделях в одном чате: чужое не уходит, своё возвращается", async () => {
    const chatId = `live-switch-${Date.now()}`;
    const history: AgentChatMessage[] = [];
    const answers: AgentChatMessage[] = [];
    const firstBodies: string[] = [];
    const texts: string[] = [];

    for (const [turn, choice] of route.entries()) {
      history.push({ id: `u${turn}`, role: "user", parts: [{ type: "text", text: questions[turn]! }] });
      const bodies: string[] = [];
      const recordingFetch: typeof globalThis.fetch = async (input, init) => {
        if (typeof init?.body === "string") bodies.push(init.body);
        return globalThis.fetch(input, init);
      };
      const request = await buildModelRequest({
        catalog: standardCatalog,
        ...choice,
        chatId,
        instructions,
        tools,
        history,
        env: process.env,
        fetch: recordingFetch,
      });
      const result = streamText({ ...request, stopWhen: stepCountIs(6), maxRetries: 0 });
      let answer: AgentChatMessage | undefined;
      for await (const message of readUIMessageStream<AgentChatMessage>({
        stream: result.toUIMessageStream<AgentChatMessage>({ sendReasoning: true }),
      })) {
        answer = message;
      }
      texts.push((await Promise.resolve(result.text).catch(() => "")).trim());
      const complete: AgentChatMessage = {
        ...(answer ?? { id: `a${turn}`, role: "assistant", parts: [] }),
        metadata: { modelId: choice.modelId, providerId: choice.providerId, status: "complete" },
      };
      answers.push(complete);
      history.push(complete);
      firstBodies.push(bodies[0] ?? "");
    }

    const pieces = (message: AgentChatMessage) => [...reasoningTexts(message), ...providerSecrets(message)];
    const inBody = (body: string, piece: string) => body.includes(JSON.stringify(piece).slice(1, -1));
    console.log("[смена модели]", JSON.stringify(texts), JSON.stringify(answers.map((answer) => pieces(answer).length)));

    texts.forEach((text, turn) => expect(text, `ход ${turn + 1}: ответ`).toContain(expectedAnswers[turn]!));
    // Ход 2 (GPT): в теле нет ничего из рассуждений DeepSeek, в том числе его метаданных.
    for (const piece of pieces(answers[0]!)) expect(inBody(firstBodies[1]!, piece), "рассуждение DeepSeek ушло GPT").toBe(false);
    // Ход 3 (DeepSeek): своё из хода 1 вернулось, шифр и рассуждения GPT — нет.
    for (const piece of reasoningTexts(answers[0]!)) expect(inBody(firstBodies[2]!, piece), "своё рассуждение не вернулось").toBe(true);
    for (const piece of pieces(answers[1]!)) expect(inBody(firstBodies[2]!, piece), "рассуждение GPT ушло DeepSeek").toBe(false);
  }, 300_000);
});
