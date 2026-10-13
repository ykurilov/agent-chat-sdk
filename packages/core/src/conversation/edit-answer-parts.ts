import type { AnswerEdit, AnswerEditErrorKind } from "./answer-edit";
import type { StoredMessage } from "./types";

type MessagePart = StoredMessage["parts"][number];

/** Правка ответа не принята: почему — в `kind`. */
export class AnswerEditError extends Error {
  constructor(readonly kind: AnswerEditErrorKind) {
    super(`Правка ответа не принята: ${kind}`);
    this.name = "AnswerEditError";
  }
}

/** Самый большой новый результат вызова в JSON, байт. */
export const EDITED_TOOL_OUTPUT_MAX_BYTES = 64 * 1024;

/** Разделитель текстовых частей разных шагов в тексте ответа. */
const STEP_TEXT_SEPARATOR = "\n\n";

/** Текст ответа, как его правит человек: текстовые части по порядку через пустую строку. */
export function answerText(parts: readonly MessagePart[]): string {
  return parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(STEP_TEXT_SEPARATOR);
}

/**
 * Части правленого ответа. Текст — одной частью на месте первой текстовой (нет — в конце), рассуждения убраны.
 * Вызов из `toolOutputs` получает новый результат (прежняя ошибка тоже); остальные части — как есть и в том же порядке.
 * `uneditable` — имена инструментов, чей результат не правится.
 */
export function editAnswerParts(
  parts: readonly MessagePart[],
  edit: AnswerEdit,
  uneditable: ReadonlySet<string>,
): { ok: true; parts: MessagePart[] } | { ok: false; kind: AnswerEditErrorKind } {
  if (edit.text.trim().length === 0) return { ok: false, kind: "empty_text" };
  const outputs = new Map(Object.entries(edit.toolOutputs ?? {}));
  let outputsChanged = false;
  for (const [toolCallId, output] of outputs) {
    const call = parts.find((part) => toolCallIdOf(part) === toolCallId);
    if (!call || !isEditableCall(call, uneditable) || !fitsOutputSize(output)) return { ok: false, kind: "invalid_tool_output" };
    if (!sameOutput(call, output)) outputsChanged = true;
  }
  if (!outputsChanged && edit.text === answerText(parts)) return { ok: false, kind: "nothing_changed" };

  const textPart: MessagePart = { type: "text", text: edit.text, state: "done" };
  let textPlaced = false;
  const edited = parts.flatMap((part): MessagePart[] => {
    if (part.type === "reasoning") return [];
    if (part.type === "text") {
      if (textPlaced) return [];
      textPlaced = true;
      return [textPart];
    }
    const toolCallId = toolCallIdOf(part);
    if (toolCallId === undefined || !outputs.has(toolCallId)) return [part];
    const { errorText: _errorText, ...call } = part as MessagePart & { errorText?: string };
    return [{ ...call, state: "output-available", output: outputs.get(toolCallId) } as MessagePart];
  });
  return { ok: true, parts: textPlaced ? edited : [...edited, textPart] };
}

function toolCallIdOf(part: MessagePart): string | undefined {
  return isToolPart(part) ? (part as { toolCallId: string }).toolCallId : undefined;
}

const isToolPart = (part: MessagePart): boolean => part.type.startsWith("tool-") || part.type === "dynamic-tool";

function toolNameOf(part: MessagePart): string {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
}

/** Вызов с результатом или ошибкой, чей результат не файлы и не слова человека. */
function isEditableCall(part: MessagePart, uneditable: ReadonlySet<string>): boolean {
  const { state } = part as { state?: string };
  return (state === "output-available" || state === "output-error") && !uneditable.has(toolNameOf(part));
}

function fitsOutputSize(output: unknown): boolean {
  const json = JSON.stringify(output) as string | undefined;
  return json !== undefined && new TextEncoder().encode(json).length <= EDITED_TOOL_OUTPUT_MAX_BYTES;
}

function sameOutput(part: MessagePart, output: unknown): boolean {
  const call = part as { state?: string; output?: unknown };
  return call.state === "output-available" && JSON.stringify(call.output) === JSON.stringify(output);
}
