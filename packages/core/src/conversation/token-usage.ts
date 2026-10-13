import type { LanguageModelUsage } from "ai";
import type { TokenUsage } from "./types";

export function emptyTokenUsage(): TokenUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
}

/** Прибавляет расход шага или запроса к сумме. Запись в кэш появляется в сумме, только когда её сообщил провайдер. */
export function addTokenUsage(total: TokenUsage, usage: LanguageModelUsage): void {
  total.inputTokens += usage.inputTokens ?? 0;
  total.cachedInputTokens += usage.inputTokenDetails?.cacheReadTokens ?? 0;
  total.outputTokens += usage.outputTokens ?? 0;
  total.reasoningTokens += usage.outputTokenDetails?.reasoningTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  if (cacheWrite > 0) total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + cacheWrite;
}

export function isEmptyTokenUsage(usage: TokenUsage): boolean {
  return usage.inputTokens === 0 && usage.outputTokens === 0 && usage.reasoningTokens === 0 && (usage.cacheWriteTokens ?? 0) === 0;
}
