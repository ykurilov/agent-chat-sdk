import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { TandemAgentNotice } from "./agent-notice";
import { TandemHelperCallRow } from "./helper-call-row";
import { TandemTaskCard } from "./task-card";
import { TandemWorkSteps } from "./work-steps";

/** Части договора v18 и v23 Тандема: помощники, фоновые задачи, служебные сообщения, простой вид работы. Подключаются в `tandemSkin`. */
export const tandemWorkParts = {
  HelperCallRow: TandemHelperCallRow,
  TaskCard: TandemTaskCard,
  AgentNoticeView: TandemAgentNotice,
  WorkSteps: TandemWorkSteps,
} satisfies Pick<ChatSkin, "HelperCallRow" | "TaskCard" | "AgentNoticeView" | "WorkSteps">;
