import type { TextPart } from "ai";

/** Часть-отметка в ответе: последний шаг модели оборван пределом длины ответа (FR-054). */
export const LENGTH_CUT_PART_TYPE = "data-length-cut";

/** Что видит модель в конце своего оборванного ответа на следующих ходах. Текст постоянный — кэш модели цел. */
export const LENGTH_CUT_NOTE = "[Ответ оборван: модель упёрлась в предел длины ответа]";

/** Для `convertToModelMessages`: отметка обрыва — текстом в запросе, остальные части-данные в запрос не идут. */
export function lengthCutForModel(part: { type: string }): TextPart | undefined {
  return part.type === LENGTH_CUT_PART_TYPE ? { type: "text", text: LENGTH_CUT_NOTE } : undefined;
}
