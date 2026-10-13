import { AGENT_NOTICE_PART_TYPE, type AgentNotice } from "@ykurilov/agent-chat-core";
import type { HistoryMessage } from "./chat-port";

/** Служебные сообщения о задачах: `task_done`, `task_failed`, `task_awaiting_approval` и другие `task_*`. */
export const isTaskNotice = (notice: AgentNotice) => notice.kind.startsWith("task_");

/** Служебные сообщения из сообщения истории; обычное сообщение — пусто. */
export function noticesOf(message: HistoryMessage): AgentNotice[] {
  const part = message.parts.find((item) => item.type === AGENT_NOTICE_PART_TYPE);
  const notices = (part?.data as { notices?: unknown } | undefined)?.notices;
  return Array.isArray(notices) ? (notices as AgentNotice[]) : [];
}

/** Служебные сообщения, на которые отвечает последний ход: последнее сообщение «от человека» в истории. */
export function noticesOfLastTurn(messages: ReadonlyArray<HistoryMessage>): AgentNotice[] {
  const last = messages.findLast((message) => message.role === "user");
  return last ? noticesOf(last) : [];
}
