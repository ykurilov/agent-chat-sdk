import type { AgentChatMessage } from "../conversation/types";

type MessagePart = AgentChatMessage["parts"][number];

/** Что видит модель, когда человек не ответил в виджете, а написал сообщение. Сообщение идёт следом. */
export const ANSWERED_BY_MESSAGE = { ответ: "сообщением" } as const;

/** Что видит модель о втором и следующих ждущих вызовах одного шага (FR-003). */
export const ONE_QUESTION_AT_A_TIME = "Задавай один вопрос за раз";

interface ToolPartView {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
}

const isToolPart = (part: MessagePart): boolean => part.type.startsWith("tool-") || part.type === "dynamic-tool";

function toolNameOf(part: MessagePart): string {
  return part.type === "dynamic-tool" ? ((part as ToolPartView).toolName ?? "") : part.type.slice("tool-".length);
}

/** Ждущий виджет: вызов ждущего виджета из `widgetNames` в `input-available`, без результата. */
export function isPendingWidgetCall(part: MessagePart, widgetNames: ReadonlySet<string>): boolean {
  return isToolPart(part) && (part as ToolPartView).state === "input-available" && widgetNames.has(toolNameOf(part));
}

/** Ждущие виджеты ответа. */
export function pendingWidgetCalls(parts: readonly MessagePart[], widgetNames: ReadonlySet<string>): MessagePart[] {
  return parts.filter((part) => isPendingWidgetCall(part, widgetNames));
}

/** Ждущий вызов виджета `toolCallId` и имя виджета; нет такого — `undefined`. */
export function pendingWidgetCall(
  parts: readonly MessagePart[],
  toolCallId: string,
  widgetNames: ReadonlySet<string>,
): { toolName: string; input: unknown } | undefined {
  const part = parts.find((candidate) => isPendingWidgetCall(candidate, widgetNames) && (candidate as ToolPartView).toolCallId === toolCallId);
  return part && { toolName: toolNameOf(part), input: (part as { input?: unknown }).input };
}

/**
 * Лишние ждущие вызовы: в шаге ждёт не больше одного виджета, остальные получают ошибку «Задавай один вопрос за раз».
 * Ждать может только последний шаг ответа, поэтому лишние — все ждущие после первого.
 */
export function extraWidgetCallIds(parts: readonly MessagePart[], widgetNames: ReadonlySet<string>): string[] {
  return pendingWidgetCalls(parts, widgetNames)
    .slice(1)
    .map((part) => (part as ToolPartView).toolCallId!);
}

/** Части с ответом `output` на ждущий вызов `toolCallId`; уже закрытые части с тем же id не меняются. Исходные части не меняются. */
export function recordWidgetAnswer(parts: readonly MessagePart[], toolCallId: string, output: unknown): MessagePart[] {
  return parts.map((part) =>
    isToolPart(part) && (part as ToolPartView).toolCallId === toolCallId && (part as ToolPartView).state === "input-available"
      ? ({ ...part, state: "output-available", output } as MessagePart)
      : part,
  );
}

/** Все ждущие виджеты закрыты пометкой «ответ сообщением» (FR-006). Нет ждущих — тот же массив. */
export function closeWidgetsByMessage(parts: readonly MessagePart[], widgetNames: ReadonlySet<string>): readonly MessagePart[] {
  if (!parts.some((part) => isPendingWidgetCall(part, widgetNames))) return parts;
  return parts.map((part) => (isPendingWidgetCall(part, widgetNames) ? ({ ...part, state: "output-available", output: ANSWERED_BY_MESSAGE } as MessagePart) : part));
}
