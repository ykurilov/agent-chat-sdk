import type { AgentChatMessage } from "../chat-types";
import { pendingHelperApprovalId } from "../helpers/helper-call";
import { BY_MESSAGE_KEY, BY_MESSAGE_VALUE } from "./widget-answer-keys";

/*
 * Ответ на виджет в ленте. Продолжение хода дописывает то же сообщение тем же приёмом, что и после подтверждения
 * (use-agent-chat.ts, «ВНИМАНИЕ: приём с `input-streaming`»): пока ход идёт, отвеченный вызов помечен «в пути» и несёт
 * ответ в `output`. Сервер результат виджета в поток не шлёт, поэтому в конце хода пометка снимается здесь
 * (`withWidgetAnswersSettled`).
 */

interface ToolPartFields {
  type: string;
  toolCallId?: string;
  state?: string;
  output?: unknown;
  approval?: unknown;
}

const fields = (part: AgentChatMessage["parts"][number]) => part as unknown as ToolPartFields;
const isToolPart = (part: AgentChatMessage["parts"][number]) => part.type.startsWith("tool-") || part.type === "dynamic-tool";

/** Ждущий виджет: вызов без результата и без запроса подтверждения. */
function isWaitingWidget(part: AgentChatMessage["parts"][number]): boolean {
  const tool = fields(part);
  return isToolPart(part) && tool.state === "input-available" && tool.approval === undefined;
}

/** Ответ лежит в вызове; `resumed` — ход продолжается, сообщение дописывается потоком. */
export function withWidgetAnswer(messages: AgentChatMessage[], toolCallId: string, answer: unknown, resumed: boolean): AgentChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.parts.some((part) => fields(part).toolCallId === toolCallId)) return message;
    const parts = message.parts.map((part) =>
      fields(part).toolCallId === toolCallId ? ({ ...part, state: resumed ? "input-streaming" : "output-available", output: answer } as typeof part) : part,
    );
    return { ...message, parts, ...(resumed && { metadata: { ...message.metadata, status: "streaming" as const } }) };
  });
}

/** Ход кончился: отвеченные вызовы, помеченные «в пути», получают свой результат. */
export function withWidgetAnswersSettled(messages: AgentChatMessage[]): AgentChatMessage[] {
  const settles = (part: AgentChatMessage["parts"][number]) => fields(part).state === "input-streaming" && fields(part).output !== undefined;
  if (!messages.some((message) => message.parts.some(settles))) return messages;
  return messages.map((message) =>
    message.parts.some(settles)
      ? { ...message, parts: message.parts.map((part) => (settles(part) ? ({ ...part, state: "output-available" } as typeof part) : part)) }
      : message,
  );
}

/**
 * История идущего хода сразу после ответа на виджет: последний ответ «идёт», а его последняя часть — отвеченный вызов.
 * Вызов помечается «в пути», чтобы продолжение дописало то же сообщение.
 */
export function withWidgetContinuationMarked(messages: AgentChatMessage[]): AgentChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.metadata?.status !== "streaming") return messages;
  if (last.parts.some((part) => fields(part).state === "input-streaming")) return messages;
  const index = last.parts.findLastIndex((part) => part.type !== "step-start");
  const part = last.parts[index];
  if (!part || !isToolPart(part) || fields(part).state !== "output-available" || fields(part).approval !== undefined) return messages;
  const parts = last.parts.map((item, at) => (at === index ? ({ ...item, state: "input-streaming" } as typeof item) : item));
  return [...messages.slice(0, -1), { ...last, parts }];
}

/** Ждущие виджеты последнего ответа закрыты сообщением человека (сервер делает то же, FR-006). */
export function withPendingWidgetsClosed(messages: AgentChatMessage[]): AgentChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.metadata?.status !== "awaiting_approval" || !last.parts.some(isWaitingWidget)) return messages;
  const parts = last.parts.map((part) =>
    isWaitingWidget(part) ? ({ ...part, state: "output-available", output: { [BY_MESSAGE_KEY]: BY_MESSAGE_VALUE } } as typeof part) : part,
  );
  return [...messages.slice(0, -1), { ...last, parts }];
}

/** В последнем ответе ждёт запрос подтверждения: его решает только кнопка, слова голосом его не закрывают. */
export function hasPendingApproval(messages: readonly AgentChatMessage[]): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    last.metadata?.status === "awaiting_approval" &&
    last.parts.some(
      (part) => fields(part).state === "approval-requested" || fields(part).state === "approval-responded" || pendingHelperApprovalId(part as { output?: unknown }) !== undefined,
    )
  );
}
