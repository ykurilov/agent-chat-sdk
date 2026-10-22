import type { AgentChatMessage } from "./types";

/** Storage-only envelope. Conversion removes it before messages reach a model or client. */
export const ANSWER_REASONING_PART = "data-answer-reasoning";
export function answerReasoningOf(parts: AgentChatMessage["parts"]): string | undefined {
  const part = parts.find((item) => item.type === ANSWER_REASONING_PART);
  if (!part || !("data" in part) || typeof part.data !== "object" || part.data === null) return undefined;
  const level = (part.data as { level?: unknown }).level;
  return typeof level === "string" ? level : undefined;
}
export function withoutAnswerReasoning(parts: AgentChatMessage["parts"]): AgentChatMessage["parts"] {
  return parts.some((part) => part.type === ANSWER_REASONING_PART) ? parts.filter((part) => part.type !== ANSWER_REASONING_PART) : parts;
}
export function withAnswerReasoning(parts: AgentChatMessage["parts"], level: string | undefined): AgentChatMessage["parts"] {
  if (level === undefined) return parts;
  return [...withoutAnswerReasoning(parts), { type: ANSWER_REASONING_PART, data: { level } }];
}
