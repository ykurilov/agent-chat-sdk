import type { SpendingState } from "@ykurilov/agent-chat-core";

/** Доллары считаются дробями: сравнение идёт с точностью до миллиардной доли, чтобы 0,1 + 0,2 равнялось 0,3. */
const PRECISION = 1e9;
const round = (amount: number) => Math.round(amount * PRECISION) / PRECISION;

export interface ScopeState {
  state: SpendingState;
  /** Доля израсходованного от бюджета; при нулевом бюджете — 1. */
  share: number;
}

export function spendingState(input: { spentUsd: number; limitUsd: number; warnAt: number }): ScopeState {
  const spent = round(input.spentUsd);
  const limit = round(input.limitUsd);
  const share = limit > 0 ? round(spent / limit) : 1;
  if (spent >= limit) return { state: "exhausted", share };
  if (share >= input.warnAt) return { state: "warning", share };
  return { state: "ok", share };
}
