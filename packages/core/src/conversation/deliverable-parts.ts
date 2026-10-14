import type { StoredMessage } from "./types";

type MessagePart = StoredMessage["parts"][number];

/**
 * Части ответа, которые доставляют человеку: текст, файлы, источники и вызовы инструментов (карточка ролика, картинка,
 * виджет) — по порядку, как записаны. Без рассуждений модели, отметок шагов и служебных частей `data-*`.
 */
export function deliverableParts(parts: readonly MessagePart[]): MessagePart[] {
  return parts.filter((part) => part.type !== "reasoning" && part.type !== "step-start" && !part.type.startsWith("data-"));
}
