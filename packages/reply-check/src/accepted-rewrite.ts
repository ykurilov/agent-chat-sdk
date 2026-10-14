import { FOREIGN_WORDS_NOTE, UNKNOWN_LINKS_NOTE } from "./rewrite-notes";

/** Переписанный ответ короче этой доли исходного — смысл мог уйти. */
const MIN_LENGTH_RATIO = 0.6;

/** Во сколько раз переписанный ответ может быть длиннее исходного, если приложение не задало своё. */
export const DEFAULT_MAX_LENGTH_RATIO = 1.5;

/**
 * Переписанный текст, который можно отдать человеку; иначе пусто — и уходит исходный. Отбрасывается ответ со служебной
 * строкой запроса (модель повторила её) и, если длина важна, ответ, который сильно поменял длину.
 */
export function acceptedRewrite(original: string, rewritten: string, options: { sameLength?: { maxRatio: number } } = {}): string {
  const text = rewritten.trim();
  if (!text || text.includes(FOREIGN_WORDS_NOTE) || text.includes(UNKNOWN_LINKS_NOTE)) return "";
  if (options.sameLength) {
    const ratio = text.length / Math.max(original.trim().length, 1);
    if (ratio < MIN_LENGTH_RATIO || ratio > options.sameLength.maxRatio) return "";
  }
  return text;
}
