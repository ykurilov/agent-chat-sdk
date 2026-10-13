import type { AgentChatMessage } from "../chat-types";
import { SUGGEST_REPLIES } from "./widget-view";

/** Больше подсказок под ответом не показывается (FR-015). */
const MAX_SUGGESTED_REPLIES = 4;

/**
 * Подсказки ответа: последний вызов `suggest_replies` в последнем ответе ветки. Пока идёт ход или последнее слово
 * за человеком — подсказок нет. Пустые строки и не строки отбрасываются.
 */
export function suggestedRepliesOf(messages: readonly AgentChatMessage[], busy: boolean): string[] | null {
  if (busy) return null;
  const last = messages.at(-1);
  if (last?.role !== "assistant") return null;
  const call = last.parts.findLast(
    (part) => part.type === `tool-${SUGGEST_REPLIES}` && (part as { state?: string }).state !== "input-streaming",
  );
  const replies = (call as { input?: { replies?: unknown } } | undefined)?.input?.replies;
  if (!Array.isArray(replies)) return null;
  const usable = replies.filter((reply): reply is string => typeof reply === "string" && reply.trim().length > 0).slice(0, MAX_SUGGESTED_REPLIES);
  return usable.length > 0 ? usable : null;
}
