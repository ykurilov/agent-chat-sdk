import { isEmptyTokenUsage } from "../conversation/token-usage";
import type { TokenUsage, UsageSource, UsageSum } from "../conversation/types";
import type { ModelCatalog } from "../models/model-catalog";
import type { ChatStorage } from "../storage/chat-storage";
import { costOfSteps, costOfUsage } from "./usage-cost";

export interface SpentTokens {
  storage: ChatStorage;
  /** Из профиля модели берутся цены на этот момент: их и запоминает запись. */
  catalog: ModelCatalog;
  ownerId: string;
  chatId: string;
  messageId: string | null;
  source: UsageSource;
  modelId: string;
  providerId: string;
  spent: TokenUsage;
  /** Расход каждого запроса хода, вместе дающий `spent`: по нему выбирается ступень цены. Нет — весь расход один запрос. */
  steps?: readonly (TokenUsage & { at?: string })[];
  /** Когда начался ход (сжатие): в каком периоде лимита сидит расход. */
  startedAt: string;
  logError: (message: string) => void;
}

/**
 * Дописывает запись расхода вместе с его стоимостью в долларах (0, если у модели нет цены) и возвращает её номер.
 * Нулевой расход не пишется (`null`), сбой записи не бросается: он уходит в журнал сервера (`null`).
 */
export async function recordSpentTokens(input: SpentTokens): Promise<string | null> {
  const { spent } = input;
  if (isEmptyTokenUsage(spent)) return null;
  try {
    const id = crypto.randomUUID();
    await input.storage.insertUsageRecord({
      id,
      ownerId: input.ownerId,
      chatId: input.chatId,
      messageId: input.messageId,
      source: input.source,
      modelId: input.modelId,
      providerId: input.providerId,
      inputTokens: spent.inputTokens,
      cachedInputTokens: spent.cachedInputTokens,
      cacheWriteTokens: spent.cacheWriteTokens ?? 0,
      outputTokens: spent.outputTokens,
      reasoningTokens: spent.reasoningTokens,
      costUsd: costOfSpent(input),
      createdAt: input.startedAt,
      ...(spent.estimated && { estimated: true }),
    });
    return id;
  } catch (failure) {
    input.logError(`Не удалось записать расход (${input.source}, чат ${input.chatId}): ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`);
    return null;
  }
}

/** Цена по шагам (час пик — по времени шага, без него — по началу хода) или всего расхода как одного запроса. */
function costOfSpent({ catalog, modelId, providerId, spent, steps, startedAt }: SpentTokens): number {
  const price = catalog.models.find((model) => model.id === modelId)?.pricing?.[providerId];
  if (!price) return 0;
  const tokens = <T extends TokenUsage>(usage: T) => ({ ...usage, cacheWriteTokens: usage.cacheWriteTokens ?? 0 });
  return steps?.length ? costOfSteps(steps.map(tokens), price, startedAt) : costOfUsage(tokens(spent), price, startedAt);
}

type UsageField = "inputTokens" | "cachedInputTokens" | "cacheWriteTokens" | "outputTokens" | "reasoningTokens";

/** Расход сообщения без уже учтённого (записи журнала или снимок, который запишет другая копия); всё учтено — `null`. */
export function usageMinusJournaled(usage: TokenUsage, journaled: readonly Partial<Pick<UsageSum, UsageField>>[]): TokenUsage | null {
  const sum = (field: UsageField) => journaled.reduce((total, row) => total + (row[field] ?? 0), 0);
  const rest = (own: number | undefined, field: Parameters<typeof sum>[0]) => Math.max(0, (own ?? 0) - sum(field));
  const left: TokenUsage = {
    inputTokens: rest(usage.inputTokens, "inputTokens"),
    cachedInputTokens: rest(usage.cachedInputTokens, "cachedInputTokens"),
    outputTokens: rest(usage.outputTokens, "outputTokens"),
    reasoningTokens: rest(usage.reasoningTokens, "reasoningTokens"),
  };
  const cacheWriteTokens = rest(usage.cacheWriteTokens, "cacheWriteTokens");
  if (left.inputTokens === 0 && left.outputTokens === 0 && cacheWriteTokens === 0) return null;
  return { ...left, ...(cacheWriteTokens > 0 && { cacheWriteTokens }), ...(usage.estimated && { estimated: true }) };
}
