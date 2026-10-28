import { createContext } from "react";
import type { AgentChatMessage } from "./chat-types";
export interface HistoryPartReference { revision: string; type: string }
export interface HistoryView {
  mode: "compact"; branch: string; olderCursor: string | null; headMessageId: string | null;
  totals: { messages: number; assistantAnswers: number };
  stateBefore: Record<string, unknown>;
}
export type FeedChangeKind = "live" | "history" | "branch" | "older-page" | "details";
export interface FeedChange { kind: FeedChangeKind; historyComplete: boolean; view?: HistoryView }
export const HistoryDetailsContext = createContext<{
  messages: AgentChatMessage[];
  load: (partKey: string) => Promise<boolean>;
  states: Record<string, "loading" | "error">;
} | null>(null);
