import type { AgentChatMessage } from "../conversation/types";

// Только эфемерный текст сводки из applyCompaction. Не JSON-поле и не часть протокола: нельзя прислать с клиента,
// не хранится в ответах, JSON/model/history API видят прежний text. Spread при сборке запроса сохраняет отметку.
const SUMMARY = Symbol("compaction-summary");
type SummaryPart = { type: "text"; text: string; [SUMMARY]: true };

export const summaryPart = (text: string): SummaryPart => ({ type: "text", text, [SUMMARY]: true });
export const isSummaryPart = (part: AgentChatMessage["parts"][number]): boolean => (part as Partial<SummaryPart>)[SUMMARY] === true;
