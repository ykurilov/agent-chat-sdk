import type { ModelChoice } from "../models/model-choice";
/** Serializable browser-owned envelope. Only the authenticated server may mint sealed/view fields. */
export interface BrowserChatSnapshot {
  version: 1;
  ownerId: string;
  chatId: string;
  sealed: string;
  /** Gzip + base64 public history; no server secrets or raw model state. */
  view: string;
  /** Untrusted user choice, checked against the current server catalog on every turn. */
  choice?: ModelChoice;
  /** Locally persisted outgoing text not yet acknowledged by a server checkpoint. Never authority for state/tools. */
  pending?: Array<{ id: string; text: string; answerId?: string; editedMessageId?: string }>;
}
