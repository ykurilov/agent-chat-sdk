import { createHash } from "node:crypto";
import { foldAppState, BASIC_WIDGET_NAMES } from "@ykurilov/agent-chat-core";
import type { ChatHistory, AgentChatMessage } from "@ykurilov/agent-chat-core";

export interface HistoryPartReference { revision: string; type: string }
export interface HistoryView {
  mode: "compact";
  branch: string;
  olderCursor: string | null; headMessageId: string | null;
  totals: { messages: number; assistantAnswers: number };
  stateBefore: Record<string, unknown>;
}
export class HistoryViewConflict extends Error {}
export class InvalidHistoryView extends Error {}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Only the already authorized, capability-filtered browser history enters this projection. */
export function historyBranch(history: ChatHistory): string {
  return digest([history.chat.id, history.messages.map(message => message.id), history.forks]);
}
const basic = new Set<string>(BASIC_WIDGET_NAMES);
function compactMessage(message: AgentChatMessage, eagerTools: ReadonlySet<string>): AgentChatMessage {
  if (message.role !== "assistant" || message.metadata?.status === "streaming" || message.metadata?.status === "awaiting_approval") return message;
  const refs: Record<number, HistoryPartReference> = {};
  const parts = message.parts.map((part, index) => {
    const value = part as unknown as Record<string, unknown>;
    if (part.type === "reasoning" && part.text.length > 0) {
      refs[index] = { revision: digest(part), type: part.type };
      return { type: part.type, text: "", state: part.state };
    }
    if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
      const name = part.type === "dynamic-tool" ? String(value.toolName) : part.type.slice(5);
      if (basic.has(name) || name.startsWith("helper_") || eagerTools.has(name) || (value.state !== "output-available" && value.state !== "output-error")) return part;
      refs[index] = { revision: digest(part), type: part.type };
      // Preserve identity/state/title/approval. Never expose partial JSON as if it were the real input/output.
      const { input, output, rawInput, errorText, callProviderMetadata, providerMetadata, ...small } = value;
      return small;
    }
    return part;
  });
  return { ...message, parts: parts as AgentChatMessage["parts"], metadata: { ...message.metadata, historyRevision: digest(message), historyDetails: refs } } as AgentChatMessage;
}
export function compactHistory(history: ChatHistory, query: URLSearchParams, eagerTools: readonly string[] = []) {
  const branch = historyBranch(history);
  const expected = query.get("branch");
  if (expected !== null && expected !== branch) throw new HistoryViewConflict();
  const size = Number(query.get("limit") ?? 30);
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new InvalidHistoryView();
  const before = query.get("before");
  const end = before === null ? history.messages.length : history.messages.findIndex(message => message.id === before);
  if (end < 0) throw new HistoryViewConflict();
  const through = query.get("through");
  const anchor = through === null ? -1 : history.messages.findIndex(message => message.id === through);
  const start = anchor < 0 ? Math.max(0, end - size) : Math.min(anchor, Math.max(0, end - size));
  const messages = history.messages.slice(start, end).map(message => compactMessage(message, new Set(eagerTools)));
  const view: HistoryView = { stateBefore: foldAppState(history.messages.slice(0, start)), mode: "compact", branch, headMessageId: history.messages.at(-1)?.id ?? null, olderCursor: start > 0 ? messages[0]!.id : null,
    totals: { messages: history.messages.length, assistantAnswers: history.messages.filter(message => message.role === "assistant").length } };
  return { ...history, messages, historyView: view };
}
export function historyPart(history: ChatHistory, query: URLSearchParams) {
  const branch = historyBranch(history);
  if (query.get("branch") !== branch) throw new HistoryViewConflict();
  const messageId = query.get("messageId"), index = Number(query.get("partIndex"));
  if (!messageId || query.get("partIndex") === null || !Number.isSafeInteger(index) || index < 0) throw new InvalidHistoryView();
  const message = history.messages.find(item => item.id === messageId);
  const part = message?.parts[index];
  if (!part) throw new HistoryViewConflict();
  const revision = digest(part);
  if (query.get("revision") !== revision) throw new HistoryViewConflict();
  return { branch, messageId, partIndex: index, revision, part };
}

/** Full authorized message for editors; never reads raw storage. */
export function historyMessage(history: ChatHistory, query: URLSearchParams) {
  const branch = historyBranch(history);
  if (query.get("branch") !== branch) throw new HistoryViewConflict();
  const messageId = query.get("messageId");
  if (!messageId) throw new InvalidHistoryView();
  const message = history.messages.find(item => item.id === messageId);
  if (!message || query.get("revision") !== digest(message)) throw new HistoryViewConflict();
  return { branch, messageId, revision: digest(message), message };
}
