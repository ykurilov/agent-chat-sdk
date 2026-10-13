import type { FileUIPart } from "ai";
import type { AgentChatMessage } from "../chat-types";

/** Отметка поправки в частях сообщения: написано во время ответа (как у сервера, core: steering/turn-steering.ts). */
export const STEER_PART_TYPE = "data-agent-steer";

/** Поправка на экране: текст и файлы человека с отметкой поправки. */
export function correctionMessage(id: string, text: string, files: readonly FileUIPart[]): AgentChatMessage {
  const parts = [...files, ...(text.trim().length > 0 ? [{ type: "text" as const, text }] : []), { type: STEER_PART_TYPE, data: true }];
  return { id, role: "user", parts } as AgentChatMessage;
}

export function isCorrection(message: Pick<AgentChatMessage, "role" | "parts">): boolean {
  return message.role === "user" && message.parts.some((part) => part.type === STEER_PART_TYPE);
}

/**
 * Ответы, за которыми идёт поправка: агент закончил их на границе шага, чтобы взять поправку. Пустой такой ответ —
 * не «модель не дала ответа». Строка номеров через пробел: не меняется, пока не меняется состав.
 */
export function steeredAnswerIdsOf(feed: readonly AgentChatMessage[]): string {
  return feed.flatMap((message, index) => (message.role === "assistant" && feed[index + 1] && isCorrection(feed[index + 1]!) ? [message.id] : [])).join(" ");
}

/** Сообщение для `POST …/steer`: отметку поправки сервер ставит сам. */
export function outgoingCorrection(correction: AgentChatMessage): AgentChatMessage {
  return { ...correction, parts: correction.parts.filter((part) => part.type !== STEER_PART_TYPE) };
}

/**
 * Поправки после чтения истории: ждущие на сервере, затем свои, что ещё идут на сервер. Своя, которая уже в ленте
 * или среди ждущих, второй раз не показывается.
 */
export function correctionsAfterHistory(
  waiting: readonly AgentChatMessage[],
  shown: readonly AgentChatMessage[],
  own: readonly AgentChatMessage[],
  sendingIds: ReadonlySet<string>,
): AgentChatMessage[] {
  const known = new Set([...waiting, ...shown].map((message) => message.id));
  return [...waiting, ...own.filter((message) => sendingIds.has(message.id) && !known.has(message.id))];
}
