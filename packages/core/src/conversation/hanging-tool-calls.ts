import { APP_STATE_PART_TYPE } from "../app-state/app-state";
import { FROZEN_CONTEXT_PART_TYPE } from "../frozen-context/context-blocks";
import { cutAtCharBoundary, withoutLoneSurrogates } from "../text/safe-truncate";
import { HANGING_TOOL_CALL_REASON, NOT_STARTED_TOOL_CALL_REASON } from "../tool-approval/approval-parts";
import type { AgentChatMessage } from "./types";

type MessagePart = AgentChatMessage["parts"][number];

interface ToolPartView {
  type: string;
  toolCallId?: string;
  state?: string;
  preliminary?: boolean;
  output?: unknown;
}

/** Промежуточный вывод в тексте оборванного вызова — не длиннее этого, знаков. */
const PRELIMINARY_OUTPUT_MAX_LENGTH = 2000;

const isToolPart = (part: MessagePart): boolean => part.type.startsWith("tool-") || part.type === "dynamic-tool";

/** Вызов без окончательного результата: запущен (`input-available`) или отдал только промежуточный (`preliminary`). */
export const isHangingToolCall = (part: MessagePart): boolean => {
  if (!isToolPart(part)) return false;
  const { state, preliminary } = part as ToolPartView;
  return state === "input-available" || (state === "output-available" && preliminary === true);
};

/**
 * Текст ошибки оборванного вызова (FR-053): действие могло выполниться частично. Был промежуточный вывод — он идёт
 * следом (строка как есть, остальное — JSON), обрезанный до 2000 знаков. Из той же части — те же байты (кэш модели).
 */
export function hangingToolCallText(part: MessagePart): string {
  const { state, preliminary, output } = part as ToolPartView;
  if (state !== "output-available" || preliminary !== true || output === undefined) return HANGING_TOOL_CALL_REASON;
  const text = withoutLoneSurrogates(typeof output === "string" ? output : (JSON.stringify(output) ?? String(output)));
  const shown =
    text.length > PRELIMINARY_OUTPUT_MAX_LENGTH
      ? `${cutAtCharBoundary(text, PRELIMINARY_OUTPUT_MAX_LENGTH)}… [обрезано: показано ${PRELIMINARY_OUTPUT_MAX_LENGTH} из ${text.length} знаков]`
      : text;
  return `${HANGING_TOOL_CALL_REASON}\nПоследний промежуточный вывод: ${shown}`;
}

interface CloseOptions {
  /** Вызов ждал очереди и отменён, не начавшись: закрывается текстом «не запускался». */
  notStarted?: (toolCallId: string) => boolean;
}

/**
 * Вызовы без результата закрыты ошибкой (`hangingToolCallText`): модель не принимает вызов без результата.
 * Не начавшиеся (`notStarted`) — текстом «не запускался». Подтверждения и `input-streaming` не трогаются.
 * Нет изменений — тот же массив.
 */
export function closeHangingToolCalls(parts: MessagePart[], options?: CloseOptions): MessagePart[];
export function closeHangingToolCalls(parts: readonly MessagePart[], options?: CloseOptions): readonly MessagePart[];
export function closeHangingToolCalls(parts: readonly MessagePart[], options: CloseOptions = {}): readonly MessagePart[] {
  if (!parts.some(isHangingToolCall)) return parts;
  return parts.map((part) => {
    if (!isHangingToolCall(part)) return part;
    const { output: _output, preliminary: _preliminary, ...rest } = part as MessagePart & { output?: unknown; preliminary?: boolean };
    const { toolCallId } = part as ToolPartView;
    const neverStarted = toolCallId !== undefined && options.notStarted?.(toolCallId) === true;
    return { ...rest, state: "output-error", errorText: neverStarted ? NOT_STARTED_TOOL_CALL_REASON : hangingToolCallText(part) } as MessagePart;
  });
}

/** Вызов с окончательным результатом: результат, ошибка или отказ (и закрытый как висящий — действие могло выполниться). */
const isFinished = (part: MessagePart): boolean => {
  if (!isToolPart(part)) return false;
  const { state, preliminary } = part as ToolPartView;
  return (state === "output-available" && preliminary !== true) || state === "output-error" || state === "output-denied";
};

const isStreamingInput = (part: MessagePart): boolean => isToolPart(part) && (part as ToolPartView).state === "input-streaming";

/** Часть без рассуждений и метаданных прежнего провайдера: другой модели они не нужны и могут сломать запрос. */
function withoutProviderData(part: MessagePart): MessagePart {
  const { providerMetadata: _provider, callProviderMetadata: _call, resultProviderMetadata: _result, ...rest } = part as MessagePart & {
    providerMetadata?: unknown;
    callProviderMetadata?: unknown;
    resultProviderMetadata?: unknown;
  };
  return rest as MessagePart;
}

/**
 * Выполненные шаги оборванного ответа для «Повторить»: части до последнего вызова с окончательным результатом
 * включительно, висящие закрыты, недописанные аргументы выброшены. Записи состояния после него сохраняются: их
 * сделали законченные вызовы (у параллельных записи идут после всех вызовов шага). Заметка продолжения после него
 * (человек ответил на виджет) — тоже: она уже ушла модели на своём месте. Текст и рассуждения после
 * последнего вызова не копируются: модель напишет их заново. `sameModel = false` — рассуждения и метаданные провайдера вырезаны.
 * Нет законченных вызовов — `null`: продолжать нечего, ответ пишется с нуля.
 */
export function partsForContinuation(parts: readonly MessagePart[], options: { sameModel: boolean }): MessagePart[] | null {
  const closed = closeHangingToolCalls(parts);
  let lastFinished = -1;
  closed.forEach((part, index) => {
    if (isFinished(part)) lastFinished = index;
  });
  if (lastFinished < 0) return null;
  const steps = closed.filter((part, index) => (index <= lastFinished ? !isStreamingInput(part) : part.type === APP_STATE_PART_TYPE || part.type === FROZEN_CONTEXT_PART_TYPE));
  if (options.sameModel) return steps;
  return steps.filter((part) => part.type !== "reasoning").map(withoutProviderData);
}
