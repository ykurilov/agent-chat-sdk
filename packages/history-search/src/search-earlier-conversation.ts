import { activeCompaction, isVoiceMessage, loadCurrentBranch } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { searchableText } from "./message-text";
import { findWord, normalizeText, queryWords } from "./words";

export interface Finding {
  messageId: string;
  role: "user" | "assistant";
  createdAt: string;
  snippet: string;
}

export type EarlierConversationSearch =
  | { status: "not-compacted" }
  | { status: "empty-query" }
  | { status: "none" }
  | { status: "found"; findings: Finding[]; totalFound: number };

export interface SearchInput {
  storage: Pick<ChatStorage, "listMessages" | "listCompactions" | "listBranchSelections">;
  chatId: string;
  query: string;
  maxResults: number;
  snippetChars: number;
}

function snippetAround(text: string, at: number, length: number): string {
  if (text.length <= length) return text;
  const start = Math.max(0, Math.min(at - Math.floor(length / 4), text.length - length));
  const end = Math.min(text.length, start + length);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Ищет слова запроса в том, что сжатие заменило сводкой: в сообщениях текущей ветки от начала чата до конца
 * сжатого куска. Что осталось перед глазами модели, не ищется. Сначала сообщения, где нашлось больше слов.
 */
export async function searchEarlierConversation(input: SearchInput): Promise<EarlierConversationSearch> {
  const words = queryWords(input.query);
  if (words.length === 0) return { status: "empty-query" };

  const branch = await loadCurrentBranch(input.storage, input.chatId);
  const active = activeCompaction(branch, await input.storage.listCompactions(input.chatId));
  if (!active) return { status: "not-compacted" };

  const compacted = branch.slice(0, active.throughIndex + 1);
  const found: Array<Finding & { score: number }> = [];
  let voiceTurn = false;
  for (const message of compacted) {
    if (message.role === "user") voiceTurn = isVoiceMessage(message);
    const text = searchableText(message, { voiceAnswer: voiceTurn }).replace(/\s+/g, " ").trim();
    const normalized = normalizeText(text);
    const places = words.map((word) => findWord(normalized, word)).filter((place) => place >= 0);
    if (places.length === 0) continue;
    found.push({
      messageId: message.id,
      role: message.role,
      createdAt: message.createdAt,
      snippet: snippetAround(text, Math.min(...places), input.snippetChars),
      score: places.length,
    });
  }
  if (found.length === 0) return { status: "none" };

  const ranked = found.map((finding, order) => ({ finding, order })).sort((a, b) => b.finding.score - a.finding.score || a.order - b.order);
  const findings = ranked.slice(0, input.maxResults).map(({ finding: { score: _score, ...finding } }) => finding);
  return { status: "found", findings, totalFound: found.length };
}
