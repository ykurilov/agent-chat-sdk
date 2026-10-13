import type { ModelCatalog } from "../models/model-catalog";
import type { TurnSpendingRules } from "../spending/spending-limits";
import { costOfSteps } from "../usage/usage-cost";
import type { TurnUsage } from "./turn-usage";

export type TurnBudget = ReturnType<typeof createTurnBudget>;

/**
 * Потолки хода (`TurnSpendingRules`): деньги — по ценам профиля и шагам хода всех попыток, вызовы — по завершённым
 * шагам. Проверка между шагами: шаг, начатый до потолка, доделывается. У пары без цены потолок денег не действует.
 */
export function createTurnBudget(rules: TurnSpendingRules | undefined, input: { catalog: ModelCatalog; modelId: string; turnUsage: TurnUsage }) {
  let toolCalls = 0;
  const profile = input.catalog.models.find((model) => model.id === input.modelId);

  function spentUsd(): number {
    let total = 0;
    for (const group of input.turnUsage.stepsByProvider()) {
      const price = profile?.pricing?.[group.providerId];
      if (price) total += costOfSteps(group.steps.map((step) => ({ ...step, cacheWriteTokens: step.cacheWriteTokens ?? 0 })), price);
    }
    return total;
  }

  return {
    countToolCalls(count: number): void {
      toolCalls += count;
    },
    /** Ход дошёл до потолка: следующий шаг — итоговый, без инструментов. */
    reached(): boolean {
      if (!rules) return false;
      if (rules.maxToolCalls !== undefined && toolCalls >= rules.maxToolCalls) return true;
      return rules.maxCostUsd !== undefined && spentUsd() >= rules.maxCostUsd;
    },
  };
}
