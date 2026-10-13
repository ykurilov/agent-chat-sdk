import type { ReasoningLevelId } from "./model-catalog";

/** Сила рассуждений в запросе к провайдеру: «Максимум» уходит как `xhigh`. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Доля наибольшего бюджета на уровне: «Максимум» — весь, ниже — как у OpenRouter (95/80/50/20/10 %), от наибольшего. */
const LEVEL_SHARE: Partial<Record<ReasoningLevelId, number>> = { max: 1, high: 0.8, medium: 0.5, low: 0.2, minimal: 0.1 };

/** Шкала OpenRouter: какую долю потолка вывода сила рассуждений отдаёт на рассуждения. От глубокого к мелкому. */
const EFFORT_SHARE: ReadonlyArray<readonly [ReasoningEffort, number]> = [
  ["xhigh", 0.95],
  ["high", 0.8],
  ["medium", 0.5],
  ["low", 0.2],
  ["minimal", 0.1],
];

/** Меньше Anthropic не принимает. */
const MIN_BUDGET_TOKENS = 1_024;
/** Больше Anthropic не принимает. */
const MAX_BUDGET_TOKENS = 128_000;
/** Запас на ответ: не меньше 16 тысяч (вызов инструмента с файлом), но не больше половины потолка. */
const ANSWER_FLOOR_TOKENS = 16_000;
/**
 * Доля потолка на ответ. Пятая часть: у 128 тысяч это 25 600 — с избытком на вызов инструмента с большим файлом, и
 * ровно столько оставляет `high` по шкале OpenRouter. Четверть отрезала бы `high` и роняла «Максимум» до `medium`.
 */
const ANSWER_SHARE = 0.2;

/** Сила рассуждений уровня без поправок. «Выкл» и «Вкл» силы не имеют. */
export function plainEffort(level: ReasoningLevelId): ReasoningEffort | undefined {
  if (level === "off" || level === "on") return undefined;
  return level === "max" ? "xhigh" : level;
}

/**
 * Сколько токенов вывода остаётся ответу при потолке `maxOutputTokens`: пятая часть потолка, но не меньше 16 тысяч; у
 * малого потолка — половина.
 */
export function answerReserveTokens(maxOutputTokens: number): number {
  return Math.ceil(Math.max(maxOutputTokens * ANSWER_SHARE, Math.min(ANSWER_FLOOR_TOKENS, maxOutputTokens / 2)));
}

/**
 * Жёсткий бюджет рассуждений на уровне для запроса с потолком вывода `maxOutputTokens`. Ответу остаётся запас
 * (`answerReserveTokens`): у 128 тысяч на «Максимуме» бюджет 102 400, на ответ 25 600. Бюджет всегда меньше потолка
 * (правило Anthropic: `budget_tokens < max_tokens`). Числа зависят только от уровня и потолка: запрос побайтно одинаков
 * от хода к ходу. `undefined` — у уровня нет бюджета («Выкл», «Вкл») или потолок мал для бюджета от 1024 с запасом.
 */
export function reasoningBudgetTokens(level: ReasoningLevelId, maxOutputTokens: number): number | undefined {
  const share = LEVEL_SHARE[level];
  if (share === undefined) return undefined;
  const largest = Math.min(maxOutputTokens - answerReserveTokens(maxOutputTokens), MAX_BUDGET_TOKENS);
  if (largest < MIN_BUDGET_TOKENS) return undefined;
  return Math.max(MIN_BUDGET_TOKENS, Math.floor(largest * share));
}

/**
 * Сила рассуждений для модели, у которой сила — доля потолка вывода (`reasoning.effortShareOfOutput`): самая глубокая
 * не глубже заказанной, после доли которой ответу остаётся запас (`answerReserveTokens`). При потолке 128 000
 * «Максимум» (`xhigh`, ответу 6 400) уходит как `high` (ответу 25 600), при 32 000 — как `medium`. Зависит только от
 * уровня и потолка: запрос побайтно одинаков от хода к ходу. `undefined` — «Выкл» и «Вкл».
 */
export function effortWithAnswerReserve(level: ReasoningLevelId, maxOutputTokens: number): ReasoningEffort | undefined {
  const asked = plainEffort(level);
  if (asked === undefined) return undefined;
  const reserve = answerReserveTokens(maxOutputTokens);
  const deeperFirst = EFFORT_SHARE.slice(EFFORT_SHARE.findIndex(([effort]) => effort === asked));
  const fitting = deeperFirst.find(([, share]) => maxOutputTokens - Math.floor(maxOutputTokens * share) >= reserve);
  // Запас не больше половины потолка, а `medium` отдаёт ровно половину: подходящий уровень есть всегда.
  return (fitting ?? deeperFirst.at(-1)!)[0];
}
