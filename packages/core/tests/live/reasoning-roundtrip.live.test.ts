// Живая проверка у настоящих провайдеров (FR-029): возвращаются ли рассуждения модели
// в цикле с инструментами и между ходами, работает ли кэш. Ключи — только из окружения.
import { readUIMessageStream, stepCountIs, streamText, tool } from "ai";
import type { LanguageModelUsage, StepResult, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildModelRequest } from "../../src/agent-run/build-model-request";
import type { AgentChatMessage } from "../../src/conversation/types";
import { standardCatalog } from "../../src/models/standard-catalog";

const modelId = "deepseek-4.1-flash";
const providerIds = ["deepseek", "fireworks", "together"] as const;
const turnsForReliability = 10;

const instructions = [
  "Ты аккуратный помощник-вычислитель в тестовом стенде модуля чата.",
  "Правила работы:",
  "1. Любое сложение делай только инструментом add. Не складывай в уме, даже если числа простые.",
  "2. Если нужно несколько сложений подряд, вызывай add по очереди: следующий вызов — после результата предыдущего.",
  "3. Не придумывай результаты инструментов и не пропускай шаги.",
  "4. Итоговый ответ — одно число без пояснений, если собеседник не просит иного.",
  "5. Отвечай по-русски.",
].join("\n");

const tools = {
  add: tool({
    description: "Складывает два числа и возвращает сумму.",
    inputSchema: z.object({ a: z.number().describe("Первое слагаемое"), b: z.number().describe("Второе слагаемое") }),
    execute: async ({ a, b }) => a + b,
  }),
} satisfies ToolSet;

const twoCallsQuestion = "Сложи 17 и 25, потом результат сложи с 58. Ответь числом.";

interface RecordedBody {
  messages?: Array<{ role: string; content?: unknown; reasoning_content?: string; tool_calls?: unknown[] }>;
  [field: string]: unknown;
}

/** `fetch` провайдера, который записывает тела запросов. Заголовки (с ключом) не пишутся. */
function createRequestRecorder() {
  const bodies: RecordedBody[] = [];
  const recordingFetch: typeof globalThis.fetch = async (input, init) => {
    if (typeof init?.body === "string") bodies.push(JSON.parse(init.body) as RecordedBody);
    return globalThis.fetch(input, init);
  };
  return { bodies, fetch: recordingFetch };
}

function userMessage(id: string, text: string): AgentChatMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

interface TurnResult {
  answer: AgentChatMessage | undefined;
  text: string;
  steps: StepResult<ToolSet>[];
  totalUsage: LanguageModelUsage | undefined;
  errors: string[];
  bodies: RecordedBody[];
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { statusCode?: number; responseBody?: string };
    const body = details.responseBody ? ` ${details.responseBody.slice(0, 500)}` : "";
    return `${error.name}${details.statusCode ? ` ${details.statusCode}` : ""}: ${error.message}${body}`;
  }
  return String(error);
}

async function runTurn(input: {
  providerId: string;
  chatId: string;
  history: AgentChatMessage[];
}): Promise<TurnResult> {
  const recorder = createRequestRecorder();
  const errors: string[] = [];
  const request = await buildModelRequest({
    catalog: standardCatalog,
    modelId,
    providerId: input.providerId,
    chatId: input.chatId,
    instructions,
    tools,
    history: input.history,
    env: process.env,
    fetch: recorder.fetch,
  });
  const result = streamText({
    ...request,
    stopWhen: stepCountIs(6),
    maxRetries: 0,
    onError: ({ error }) => {
      errors.push(describeError(error));
    },
  });

  let answer: AgentChatMessage | undefined;
  for await (const message of readUIMessageStream<AgentChatMessage>({
    stream: result.toUIMessageStream<AgentChatMessage>(),
  })) {
    answer = message;
  }
  const [text, steps, totalUsage] = await Promise.all([
    Promise.resolve(result.text).catch(() => ""),
    Promise.resolve(result.steps).catch((): StepResult<ToolSet>[] => []),
    Promise.resolve(result.totalUsage).catch(() => undefined),
  ]);
  return { answer, text, steps, totalUsage, errors, bodies: recorder.bodies };
}

function assistantMessages(body: RecordedBody | undefined) {
  return (body?.messages ?? []).filter((message) => message.role === "assistant");
}

function addCallCount(steps: TurnResult["steps"]): number {
  return steps.flatMap((step) => step.toolCalls).filter((call) => call.toolName === "add").length;
}

// Последовательно: пачка параллельных ходов рядом с проверкой кэша сбивает кэш Fireworks.
describe.each(providerIds)("живая проверка рассуждений: %s", (providerId) => {
  it(`ход с двумя вызовами инструмента проходит ${turnsForReliability} из ${turnsForReliability}, рассуждения первого шага уходят во второй`, async () => {
    const turns = await Promise.all(
      Array.from({ length: turnsForReliability }, (_, index) =>
        runTurn({
          providerId,
          chatId: `live-${providerId}-${Date.now()}-${index}`,
          history: [userMessage("u1", twoCallsQuestion)],
        }),
      ),
    );

    const facts = turns.map((turn, index) => {
      const secondStepAssistant = assistantMessages(turn.bodies[1]).find((message) => message.tool_calls?.length);
      const firstStepReasoning = turn.steps[0]?.reasoningText ?? "";
      return {
        turn: index + 1,
        errors: turn.errors,
        text: turn.text.trim().slice(0, 80),
        requests: turn.bodies.length,
        addCalls: addCallCount(turn.steps),
        firstStepReasoningChars: firstStepReasoning.length,
        secondStepReasoningContentChars: secondStepAssistant?.reasoning_content?.length ?? null,
        reasoningReturnedAsIs: secondStepAssistant?.reasoning_content === firstStepReasoning,
      };
    });
    console.log(`[${providerId}] ходы:`, JSON.stringify(facts, null, 1));

    const passed = facts.filter((fact) => fact.errors.length === 0 && fact.text.length > 0);
    console.log(`[${providerId}] прошли без ошибки провайдера: ${passed.length} из ${turnsForReliability}`);

    const turnsWithReasoning = facts.filter((fact) => fact.firstStepReasoningChars > 0).length;
    console.log(`[${providerId}] ходов с рассуждением на первом шаге: ${turnsWithReasoning} из ${turnsForReliability}`);

    expect(passed).toHaveLength(turnsForReliability);
    // Модель иногда отвечает без рассуждения; тогда возвращать нечего. Проверяется, что
    // рассуждение первого шага уходит во второй без изменений, и что проверка не пустая.
    expect(turnsWithReasoning).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.addCalls).toBeGreaterThanOrEqual(2);
      expect(fact.text).toContain("100");
      // Без рассуждения на первом шаге возвращать нечего.
      if (fact.firstStepReasoningChars > 0) expect(fact.reasoningReturnedAsIs).toBe(true);
    }
  });

  it("второй ход в том же чате берёт кэш и несёт рассуждения первого хода", async () => {
    const chatId = `live-${providerId}-cache-${Date.now()}`;
    const question = userMessage("u1", twoCallsQuestion);
    const first = await runTurn({ providerId, chatId, history: [question] });
    expect(first.errors).toEqual([]);
    expect(first.answer).toBeDefined();

    const firstAnswer: AgentChatMessage = {
      ...first.answer!,
      metadata: { modelId, providerId, status: "complete" },
    };
    const firstTurnReasoning = firstAnswer.parts.flatMap((part) =>
      part.type === "reasoning" && part.text.length > 0 ? [part.text] : [],
    );

    const second = await runTurn({
      providerId,
      chatId,
      history: [question, firstAnswer, userMessage("u2", "Прибавь к последнему результату 1. Ответь числом.")],
    });

    const replayedReasoning = assistantMessages(second.bodies[0])
      .map((message) => message.reasoning_content ?? "")
      .filter((reasoning) => reasoning.length > 0);
    const facts = {
      firstTurnErrors: first.errors,
      firstTurnReasoningParts: firstTurnReasoning.length,
      secondTurnErrors: second.errors,
      secondTurnText: second.text.trim().slice(0, 80),
      secondTurnCacheReadTokens: second.steps[0]?.usage.inputTokenDetails.cacheReadTokens,
      secondTurnInputTokens: second.steps[0]?.usage.inputTokens,
      secondTurnTotalCacheReadTokens: second.totalUsage?.inputTokenDetails.cacheReadTokens,
      replayedReasoningMessages: replayedReasoning.length,
      replayedMatchesFirstTurn: firstTurnReasoning.every((reasoning) => replayedReasoning.includes(reasoning)),
      requestCacheFields: {
        prompt_cache_key: second.bodies[0]?.prompt_cache_key !== undefined,
        reasoning_history: second.bodies[0]?.reasoning_history ?? null,
      },
    };
    console.log(`[${providerId}] второй ход:`, JSON.stringify(facts, null, 1));

    expect(second.errors).toEqual([]);
    expect(facts.secondTurnText.length).toBeGreaterThan(0);
    expect(firstTurnReasoning.length).toBeGreaterThan(0);
    expect(facts.replayedMatchesFirstTurn).toBe(true);
    expect(facts.secondTurnCacheReadTokens ?? 0).toBeGreaterThan(0);
  });
});
