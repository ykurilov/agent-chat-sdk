import type { ModelProfile, ReasoningLevelId } from "./model-catalog";

/**
 * Уровень, на котором пойдёт запрос: выбранный, если он есть у модели, иначе уровень по умолчанию.
 * `null` — у модели нет выбора уровня.
 */
export function effectiveReasoningLevel(profile: ModelProfile, chosen?: string | null): ReasoningLevelId | null {
  const levels = profile.reasoning.levels ?? [];
  if (levels.length === 0) return null;
  const match = levels.find((level) => level === chosen);
  return match ?? profile.reasoning.defaultLevel ?? levels[0]!;
}
