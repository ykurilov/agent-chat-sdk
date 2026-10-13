import type { StepToSettle } from "../agent-run/turn-usage";
import type { TokenUsage } from "../conversation/types";
import type { ModelCatalog } from "../models/model-catalog";
import type { ChatStorage } from "../storage/chat-storage";
import { costOfSteps } from "./usage-cost";
import type { UsageTokens } from "./usage-cost";

/**
 * Паузы перед вопросами провайдеру, мс: данные генерации появляются через 10–20 с после её конца, у дорабатывающей
 * после «Стопа» — позже. Всего 7 вопросов за ~10 минут.
 */
export const GENERATION_LOOKUP_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 320_000];

/** Срок одного вопроса провайдеру, мс: зависший вопрос не держит сверку, следующий спросит заново. */
export const GENERATION_LOOKUP_TIMEOUT_MS = 15_000;

export interface GenerationUsageSettlement {
  storage: ChatStorage;
  catalog: ModelCatalog;
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  ownerId: string;
  chatId: string;
  messageId: string;
  modelId: string;
  /** Начало хода: поправка попадает в тот же период лимита, что и оценка. */
  startedAt: string;
  steps: readonly StepToSettle[];
  logError: (message: string) => void;
}

/**
 * Настоящий расход оборванных генераций хода (FR-058). В фоне, после записи хода: спрашивает провайдера по номерам
 * генераций с паузами `GENERATION_LOOKUP_DELAYS_MS`, пока не узнает все или не кончатся вопросы. Шаг, все генерации
 * которого узнаны, даёт поправку «настоящее минус оценка»; поправки одного провайдера — одна запись `answer_correction`
 * без пометки «примерно», деньги — разница цен по ступеням каждого запроса. Шаг без номера, провайдер без
 * `generationUsage` и неузнанная генерация — оценка остаётся. Одни нули при ненулевой оценке — «ещё не знаю»: так
 * провайдер отдаёт генерацию, которую ещё не досчитал. Не переживает перезапуск сервера: оценка тогда остаётся.
 * Не бросает: сбои — в журнал сервера.
 */
export async function settleGenerationUsage(input: GenerationUsageSettlement): Promise<void> {
  const settleable = input.steps.filter((step) => canLookUp(input, step));
  const unknownIds = new Set(settleable.flatMap((step) => step.generationIds));
  const known = new Map<string, TokenUsage>();
  const failures = new Set<string>();
  for (const delayMs of GENERATION_LOOKUP_DELAYS_MS) {
    if (unknownIds.size === 0) break;
    // Ожидание не держит процесс: выключение сервера его не ждёт.
    await new Promise((resolve) => setTimeout(resolve, delayMs).unref?.());
    await Promise.all(
      settleable.flatMap((step) =>
        step.generationIds.filter((id) => unknownIds.has(id)).map(async (generationId) => {
          const usage = await lookUp(input, step.providerId, generationId).catch((error: unknown) => {
            failures.add(error instanceof Error ? error.message : "неизвестная ошибка");
            return null;
          });
          if (!usage || (isEmpty(usage) && step.estimate && !isEmpty(step.estimate))) return;
          known.set(generationId, usage);
          unknownIds.delete(generationId);
        }),
      ),
    );
  }
  for (const step of settleable.filter((candidate) => !settled(candidate, known))) {
    input.logError(
      `[расход генерации] чат=${input.chatId} провайдер=${step.providerId} генерации=${step.generationIds.join(",")} не узнан: остаётся оценка${failures.size > 0 ? ` (сбои: ${[...failures].join("; ")})` : ""}`,
    );
  }
  for (const providerId of new Set(settleable.map((step) => step.providerId))) {
    const steps = settleable.filter((step) => step.providerId === providerId && settled(step, known));
    if (steps.length > 0) await recordCorrection(input, providerId, steps, known);
  }
}

function canLookUp(input: GenerationUsageSettlement, step: StepToSettle): boolean {
  const provider = input.catalog.providers.find((candidate) => candidate.id === step.providerId);
  return Boolean(provider?.generationUsage && input.env[provider.apiKeyEnv]);
}

function settled(step: StepToSettle, known: ReadonlyMap<string, TokenUsage>): boolean {
  return step.generationIds.every((id) => known.has(id));
}

function isEmpty(usage: TokenUsage): boolean {
  return usage.inputTokens === 0 && usage.outputTokens === 0;
}

/** Один вопрос провайдеру со сроком `GENERATION_LOOKUP_TIMEOUT_MS`: не ответил — отказ, даже если отмену не слушает. */
async function lookUp(input: GenerationUsageSettlement, providerId: string, generationId: string): Promise<TokenUsage | null> {
  const provider = input.catalog.providers.find((candidate) => candidate.id === providerId)!;
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const reason = new Error(`срок вопроса ${GENERATION_LOOKUP_TIMEOUT_MS / 1000} с`);
      deadline.abort(reason);
      reject(reason);
    }, GENERATION_LOOKUP_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      provider.generationUsage!.lookup({
        generationId,
        apiKey: input.env[provider.apiKeyEnv]!,
        ...(input.fetch && { fetch: input.fetch }),
        signal: deadline.signal,
      }),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Запись «настоящее минус оценка» по шагам одного провайдера; разницы нет — записи нет. */
async function recordCorrection(
  input: GenerationUsageSettlement,
  providerId: string,
  steps: readonly StepToSettle[],
  known: ReadonlyMap<string, TokenUsage>,
): Promise<void> {
  const actual = steps.flatMap((step) => step.generationIds.map((id) => ({ ...tokensOf(known.get(id)!), at: step.at })));
  const estimates = steps.flatMap((step) => (step.estimate ? [{ ...tokensOf(step.estimate), at: step.at }] : []));
  const difference = (field: keyof UsageTokens) =>
    actual.reduce((sum, usage) => sum + (usage[field] ?? 0), 0) - estimates.reduce((sum, usage) => sum + (usage[field] ?? 0), 0);
  const price = input.catalog.models.find((model) => model.id === input.modelId)?.pricing?.[providerId];
  const costUsd = price ? costOfSteps(actual, price, input.startedAt) - costOfSteps(estimates, price, input.startedAt) : 0;
  const correction = {
    inputTokens: difference("inputTokens"),
    cachedInputTokens: difference("cachedInputTokens"),
    cacheWriteTokens: difference("cacheWriteTokens"),
    outputTokens: difference("outputTokens"),
    reasoningTokens: difference("reasoningTokens"),
  };
  if (Object.values(correction).every((value) => value === 0) && costUsd === 0) return;
  try {
    await input.storage.insertUsageRecord({
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      chatId: input.chatId,
      messageId: input.messageId,
      source: "answer_correction",
      modelId: input.modelId,
      providerId,
      ...correction,
      costUsd,
      createdAt: input.startedAt,
    });
  } catch (failure) {
    input.logError(
      `Не удалось записать поправку расхода (чат ${input.chatId}): ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`,
    );
  }
}

function tokensOf(usage: TokenUsage): Required<UsageTokens> {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
  };
}
