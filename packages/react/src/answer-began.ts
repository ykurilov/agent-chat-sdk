import { getToolName, isToolUIPart } from "ai";
import type { AgentChatMessage } from "./chat-types";
import { SUGGEST_REPLIES } from "./widgets/widget-view";

/**
 * Ответ начался: есть текст или работа — раздумье, вызов инструмента (кроме подсказок ответа), файл, событие приложения.
 * Не начался — остановлен или оборвался «до начала». Одно понимание для экрана и для диктора; `text` — видимый текст ответа.
 */
export function answerBegan(message: AgentChatMessage, text: string): boolean {
  if (text.trim().length > 0) return true;
  if (Object.keys(message.metadata?.thoughtTitles ?? {}).length > 0) return true;
  // Сжатая история приходит без содержимого частей: такая часть — работа, просто ещё не догружена.
  return message.parts.some((part, index) => {
    if (message.metadata?.historyDetails?.[index]) return true;
    if (part.type === "reasoning") return part.text.trim().length > 0;
    if (part.type === "file" || part.type === "data-app-event") return true;
    return isToolUIPart(part) && getToolName(part) !== SUGGEST_REPLIES;
  });
}
