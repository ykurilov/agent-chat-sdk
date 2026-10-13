import type { AgentChatMessage } from "@ykurilov/agent-chat-react";
import type { AnswerEditRequest } from "../types";

/** Предел нового результата инструмента (FR-014a). */
export const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;

/** Вызовы, результат которых не правится: картинки, видео, виджеты и подсказки — у них свой вид, а не JSON. */
const NOT_EDITABLE_TOOLS = new Set(["generate_images", "show_video", "ask_choice", "ask_multi_choice", "ask_rating", "ask_form", "suggest_replies"]);

type MessagePart = AgentChatMessage["parts"][number];

/** Часть-вызов инструмента: `tool-<имя>` или `dynamic-tool` (как `isToolUIPart` и `getToolName` из `ai`; пакет от `ai` не зависит). */
export interface ToolCallPart {
  toolCallId: string;
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  title?: string;
}

export function toolCallOf(part: MessagePart): ToolCallPart | null {
  const record = part as { type: string; toolName?: unknown; toolCallId?: unknown };
  if (typeof record.toolCallId !== "string") return null;
  if (record.type === "dynamic-tool" && typeof record.toolName === "string") return part as unknown as ToolCallPart;
  if (record.type.startsWith("tool-")) return { ...(part as unknown as ToolCallPart), toolName: record.type.slice("tool-".length) };
  return null;
}

export interface ToolOutputDraft {
  toolCallId: string;
  toolName: string;
  title?: string;
  /** Исходный результат JSON-текстом; у вызова с ошибкой — пусто. */
  original: string;
  value: string;
}

export interface AnswerEditDraft {
  originalText: string;
  text: string;
  toolOutputs: ToolOutputDraft[];
}

export type ToolOutputError = "invalid" | "too_large";

export interface AnswerEditCheck {
  textError: "empty" | undefined;
  outputErrors: Record<string, ToolOutputError>;
  /** Текст не пуст, все правленые JSON верны и хоть что-то изменилось. */
  canSave: boolean;
}

/** Черновик из ответа: текст частей через пустую строку и результаты обычных вызовов, у которых результат уже есть. */
export function answerEditDraft(message: AgentChatMessage): AnswerEditDraft {
  const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
  const toolOutputs = message.parts.flatMap((part): ToolOutputDraft[] => {
    const call = toolCallOf(part);
    if (!call || (call.state !== "output-available" && call.state !== "output-error") || NOT_EDITABLE_TOOLS.has(call.toolName)) return [];
    const original = call.state === "output-available" ? (JSON.stringify(call.output, null, 2) ?? "") : "";
    const title = typeof call.title === "string" ? call.title : undefined;
    return [{ toolCallId: call.toolCallId, toolName: call.toolName, ...(title !== undefined && { title }), original, value: original }];
  });
  return { originalText: text, text, toolOutputs };
}

const isEdited = (output: ToolOutputDraft) => output.value !== output.original;

function toolOutputError(value: string): ToolOutputError | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "invalid";
  }
  return new TextEncoder().encode(JSON.stringify(parsed)).length > MAX_TOOL_OUTPUT_BYTES ? "too_large" : undefined;
}

export function checkAnswerEditDraft(draft: AnswerEditDraft): AnswerEditCheck {
  const textError = draft.text.trim().length === 0 ? "empty" : undefined;
  const outputErrors: Record<string, ToolOutputError> = {};
  for (const output of draft.toolOutputs.filter(isEdited)) {
    const error = toolOutputError(output.value);
    if (error) outputErrors[output.toolCallId] = error;
  }
  const changed = draft.text !== draft.originalText || draft.toolOutputs.some(isEdited);
  return { textError, outputErrors, canSave: !textError && Object.keys(outputErrors).length === 0 && changed };
}

/** Тело запроса: текст и только изменённые результаты. Черновик должен пройти `checkAnswerEditDraft`. */
export function answerEditRequest(draft: AnswerEditDraft): AnswerEditRequest {
  const edited = draft.toolOutputs.filter(isEdited);
  if (edited.length === 0) return { text: draft.text };
  return { text: draft.text, toolOutputs: Object.fromEntries(edited.map((output) => [output.toolCallId, JSON.parse(output.value) as unknown])) };
}
