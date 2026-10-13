import { toAgentChatMessage } from "../conversation/to-agent-chat-message";
import type { AgentChatMessage, StoredMessage } from "../conversation/types";
import type { ActiveCompaction } from "./compaction-plan";
import { summaryFrame } from "./compaction-task";

/**
 * История, которая уходит модели: без активной записи — ветка как есть, с ней — сводка и хвост после границы.
 * Сводка идёт первой текстовой частью первого сообщения хвоста (вопроса человека): роли чередуются как прежде,
 * инструкция и инструменты запроса не затрагиваются.
 */
export function applyCompaction(branch: readonly StoredMessage[], active: ActiveCompaction | null): AgentChatMessage[] {
  if (!active) return branch.map(toAgentChatMessage);
  const tail = branch.slice(active.throughIndex + 1).map(toAgentChatMessage);
  const summaryPart = { type: "text" as const, text: summaryFrame(active.record.summary) };
  const [first, ...rest] = tail;
  if (first?.role === "user") return [{ ...first, parts: [summaryPart, ...first.parts] }, ...rest];
  return [{ id: `${active.record.id}-summary`, role: "user", parts: [summaryPart] }, ...tail];
}
