import type { AgentChatMessage, BranchFork, ChatModelChoice, CompactionMarker } from "../chat-types";
import type { ChatCapabilities } from "../chat-access";

/** Wire-compatible client copy; importing it never loads the server core. */
export interface BrowserChatSnapshot {
  version: 1;
  ownerId: string;
  chatId: string;
  sealed: string;
  view: string;
  choice?: ChatModelChoice;
  pending?: Array<{ id: string; text: string; answerId?: string; editedMessageId?: string }>;
}

export interface BrowserChatHistory {
  chat: ChatModelChoice & { id: string };
  messages: AgentChatMessage[];
  running: boolean;
  detachedAnswer: boolean;
  compacting: boolean;
  compactions: CompactionMarker[];
  forks: BranchFork[];
  capabilities: ChatCapabilities;
  backgroundTasks?: boolean;
}
