import { useRef } from "react";
import type { AgentChatMessage } from "./chat-types";

/** Тип части-отметки: сообщение человека сказано голосом (то же, что `VOICE_MODE_PART_TYPE` в ядре). */
export const VOICE_MODE_PART_TYPE = "data-voice-mode";

export function isVoiceMessage(message: Pick<AgentChatMessage, "parts">): boolean {
  return message.parts.some((part) => part.type === VOICE_MODE_PART_TYPE);
}

/**
 * Ответы голосовых ходов: сообщения агента, идущие за сообщением человека с отметкой голосового режима.
 * Только в них теги голоса («[laughs]») слышны, но не видны; в остальных скобки — обычный текст.
 */
export function voiceAnswerIds(messages: readonly AgentChatMessage[]): Set<string> {
  const ids = new Set<string>();
  let voiceTurn = false;
  for (const message of messages) {
    if (message.role === "user") voiceTurn = isVoiceMessage(message);
    else if (message.role === "assistant" && voiceTurn) ids.add(message.id);
  }
  return ids;
}

/** То же, что `voiceAnswerIds`, но пока состав не изменился — тот же объект: лента не перерисовывается на каждый кусок ответа. */
export function useVoiceAnswerIds(messages: readonly AgentChatMessage[]): ReadonlySet<string> {
  const previous = useRef<Set<string>>(new Set());
  const next = voiceAnswerIds(messages);
  if (next.size !== previous.current.size || [...next].some((id) => !previous.current.has(id))) previous.current = next;
  return previous.current;
}
