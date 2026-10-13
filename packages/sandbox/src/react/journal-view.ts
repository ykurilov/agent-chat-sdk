import type { AgentChatMessage } from "@ykurilov/agent-chat-react";
import type { AnswerEditMark, JournalBlob, JournalCallResponse, JournalListResponse, Serialized } from "../types";
import { toolCallOf } from "./answer-edit-draft";
import type { ToolCallPart } from "./answer-edit-draft";
import type { SandboxLabels } from "./sandbox-labels";
import type { JournalTurnView, ModelCallDetailsView, ToolCallDetailsView } from "./sandbox-skin";

type Entry = JournalListResponse["entries"][number];
export type ModelEntry = Extract<Entry, { kind: "model" }>;
export type ToolEntry = Extract<Entry, { kind: "tool" }>;
type ModelCallResponse = Extract<JournalCallResponse, { kind: "model" }>;
type ToolCallResponse = Extract<JournalCallResponse, { kind: "tool" }>;

/** Строка журнала до вида: запись сервера или вызов без `execute`, взятый из частей сообщения. */
export type JournalRowSource =
  | { kind: "model"; id: string; entry: ModelEntry }
  | { kind: "tool"; id: string; entry: ToolEntry; part: ToolCallPart | null; outputEdited: boolean }
  | { kind: "message-tool"; id: string; messageId: string; part: ToolCallPart; outputEdited: boolean };

/** «Весь чат» и по ходу на каждый ответ агента текущей ветки. */
export function journalTurns(messages: AgentChatMessage[], labels: SandboxLabels): JournalTurnView[] {
  const answers = messages.filter((message) => message.role === "assistant");
  return [{ id: null, label: labels.wholeChat }, ...answers.map((message, index) => ({ id: message.id, label: labels.turnLabel(index + 1) }))];
}

/**
 * Строки хода (`turnId`) или всего чата (`null`) по времени. Вызовы, которых нет в журнале (виджеты, браузер,
 * подтверждения, ответы с правкой), берутся из частей сообщения и встают после последней записи своего ответа.
 */
export function journalRows(
  entries: Entry[],
  messages: AgentChatMessage[],
  edits: ReadonlyMap<string, AnswerEditMark>,
  turnId: string | null,
): JournalRowSource[] {
  const answers = messages.filter((message) => message.role === "assistant" && (turnId === null || message.id === turnId));
  const shown = turnId === null ? entries : entries.filter((entry) => entry.messageId === turnId);
  const parts = new Map(answers.flatMap((message) => message.parts.flatMap((part) => toolCallOf(part) ?? [])).map((part) => [part.toolCallId, part]));
  const edited = (messageId: string, toolCallId: string) => edits.get(messageId)?.editedToolCallIds.includes(toolCallId) ?? false;
  const rows: JournalRowSource[] = shown.map((entry) =>
    entry.kind === "model"
      ? { kind: "model", id: entry.id, entry }
      : { kind: "tool", id: entry.id, entry, part: parts.get(entry.toolCallId) ?? null, outputEdited: edited(entry.messageId, entry.toolCallId) },
  );
  const logged = new Set(shown.flatMap((entry) => (entry.kind === "tool" ? [entry.toolCallId] : [])));
  for (const message of answers) {
    const fromMessage: JournalRowSource[] = message.parts.flatMap((part) => {
      const call = toolCallOf(part);
      if (!call || logged.has(call.toolCallId) || (call.state !== "output-available" && call.state !== "output-error")) return [];
      return [{ kind: "message-tool", id: `message:${call.toolCallId}`, messageId: message.id, part: call, outputEdited: edited(message.id, call.toolCallId) }];
    });
    if (fromMessage.length === 0) continue;
    const last = rows.findLastIndex((row) => (row.kind === "message-tool" ? row.messageId : row.entry.messageId) === message.id);
    rows.splice(last < 0 ? rows.length : last + 1, 0, ...fromMessage);
  }
  return rows;
}

/** Прошлое обращение того же назначения: относительно него подсвечиваются новые сообщения. */
export function previousModelCall(entries: Entry[], callId: string): ModelEntry | null {
  const index = entries.findIndex((entry) => entry.id === callId);
  const call = entries[index];
  if (!call || call.kind !== "model") return null;
  for (let i = index - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.kind === "model" && entry.purpose === call.purpose) return entry;
  }
  return null;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function formatCost(costUsd: number | null): string | undefined {
  return costUsd === null ? undefined : `$${costUsd.toFixed(4)}`;
}

/** Значение как текст для чтения: строка как есть, остальное — отформатированный JSON. */
export function readable(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
}

/** Подробности обращения; `previousHashes` — сообщения прошлого обращения (`null` — прошлого нет, все сообщения новые). */
export function modelCallDetailsView(details: ModelCallResponse, previousHashes: ReadonlySet<string> | null): Extract<ModelCallDetailsView, { state: "ready" }> {
  const response = (details.response.content ?? {}) as { text?: string; reasoning?: string; toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>; finishReason?: string | null };
  const tools = Array.isArray(details.tools.content) ? (details.tools.content as Array<{ name: string; description?: string; inputSchema: unknown }>) : [];
  return {
    state: "ready",
    instructions: readable(details.instructions.content),
    messages: details.messages.map((blob) => messageView(blob, previousHashes)),
    tools: tools.map((tool) => ({ name: tool.name, ...(tool.description !== undefined && { description: tool.description }), inputSchema: readable(tool.inputSchema) })),
    settings: readable(details.settings.content),
    response: {
      text: response.text ?? "",
      reasoning: response.reasoning ?? "",
      toolCalls: (response.toolCalls ?? []).map((call) => ({ toolCallId: call.toolCallId, toolName: call.toolName, input: readable(call.input) })),
      finishReason: response.finishReason ?? null,
    },
    error: details.call.error,
  };
}

function messageView(blob: Serialized<JournalBlob>, previousHashes: ReadonlySet<string> | null) {
  const message = blob.content as { role?: unknown; content?: unknown } | null;
  const role = typeof message?.role === "string" ? message.role : "";
  return {
    role,
    content: readable(message && "content" in message ? message.content : blob.content),
    isNew: previousHashes === null || !previousHashes.has(blob.hash),
    truncated: blob.truncated,
  };
}

export function toolCallDetailsView(details: ToolCallResponse): Extract<ToolCallDetailsView, { state: "ready" }> {
  return {
    state: "ready",
    input: readable(details.input.content),
    output: details.output ? readable(details.output.content) : null,
    error: details.call.error,
    truncated: details.input.truncated || (details.output?.truncated ?? false),
  };
}

/** Вызов без записи в журнале: вход и результат из части сообщения. */
export function messageToolDetailsView(part: ToolCallPart): Extract<ToolCallDetailsView, { state: "ready" }> {
  return {
    state: "ready",
    input: readable(part.input),
    output: part.state === "output-available" ? readable(part.output) : null,
    error: part.state === "output-error" ? (part.errorText ?? null) : null,
    truncated: false,
  };
}
