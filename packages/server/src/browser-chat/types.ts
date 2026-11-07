import type { AgentSettings, BrowserChatSnapshot, ChatCapabilities, CompactionSettings, IncomingUserMessage, ModelCatalog, ModelChoice, ResolvedUser, UsageRecord } from "@ykurilov/agent-chat-core";

export type BrowserChatOperation =
  | { type: "bootstrap" | "models" | "retry" }
  | { type: "message"; message: IncomingUserMessage }
  | { type: "edit"; messageId: string; message: IncomingUserMessage }
  | { type: "regenerate" | "selectBranch"; messageId: string };
export interface BrowserChatRequest { chatId: string; snapshot: BrowserChatSnapshot | null; operation: BrowserChatOperation }
/** Billing metadata only; no conversation, tool arguments, or persistent chat reference. */
export type BrowserChatUsage = Omit<UsageRecord, "chatId" | "messageId">;
export interface BrowserChatSettings {
  catalog: ModelCatalog;
  agent: Omit<AgentSettings, "helpers" | "browserTools" | "browserToolTimeoutMs" | "widgets" | "voices">;
  defaultChoice?: ModelChoice;
  env?: Record<string, string | undefined>;
  compaction?: CompactionSettings | false;
  capabilities?: Partial<ChatCapabilities>;
  assertWithinLimit?: (ownerId: string, signal: AbortSignal) => Promise<void>;
  /** Durable/idempotent numeric billing. Runs on Stop too, with its own 5s deadline signal. */
  onUsage?: (usage: BrowserChatUsage, signal: AbortSignal) => Promise<void>;
}
export interface BrowserChatHandlerOptions {
  namespace: string;
  snapshotKey: string | Uint8Array;
  resolveUser: (request: Request) => Promise<ResolvedUser>;
  configure: (ownerId: string) => BrowserChatSettings | Promise<BrowserChatSettings>;
  allowedOrigins?: string[];
  maxRequestBytes?: number;
  maxSnapshotBytes?: number;
  maxTurnMs?: number;
  checkpointIntervalMs?: number;
  maxConcurrentTurnsPerUser?: number;
  /** Diagnostics have codes only. The SDK never logs raw provider errors or conversation data here. */
  onError?: (code: "configuration" | "snapshot" | "turn" | "usage" | "limit") => void;
}
export interface BrowserChatHandler {
  fetch(request: Request): Promise<Response>;
  /** Active requests only; no retained chat/session registry. */
  readonly activeRequests: number;
  close(): Promise<void>;
}
