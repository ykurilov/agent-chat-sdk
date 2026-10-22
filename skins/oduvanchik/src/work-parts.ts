import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { OduvanchikAgentNotice } from "./agent-notice";
import { OduvanchikHelperCallRow } from "./helper-call-row";
import { OduvanchikTaskCard } from "./task-card";
import { OduvanchikWorkSteps } from "./work-steps";

/** Части договора v18 и v23 Одуванчик: помощники, фоновые задачи, служебные сообщения, простой вид работы. Подключаются в `oduvanchikSkin`. */
export const oduvanchikWorkParts = {
  HelperCallRow: OduvanchikHelperCallRow,
  TaskCard: OduvanchikTaskCard,
  AgentNoticeView: OduvanchikAgentNotice,
  WorkSteps: OduvanchikWorkSteps,
} satisfies Pick<ChatSkin, "HelperCallRow" | "TaskCard" | "AgentNoticeView" | "WorkSteps">;
