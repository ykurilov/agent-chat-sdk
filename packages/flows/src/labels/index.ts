import { englishClientCardLabels, russianClientCardLabels, type ClientCardLabels } from "./client-card";
import { englishFlowEditorLabels, russianFlowEditorLabels, type FlowEditorLabels } from "./editor";
import { englishFlowMigrateLabels, russianFlowMigrateLabels, type FlowMigrateLabels } from "./migrate";
import { englishFlowNoticeLabels, russianFlowNoticeLabels, type FlowNoticeLabels } from "./notices";
import { englishFlowTestChatLabels, russianFlowTestChatLabels, type FlowTestChatLabels } from "./test-chat";

/** Все надписи экранов сценария: по словарю на экран. */
export interface FlowLabels {
  editor: FlowEditorLabels;
  clientCard: ClientCardLabels;
  migrate: FlowMigrateLabels;
  testChat: FlowTestChatLabels;
  /** Строки пометок «агент написал первым» в чате (`flowNoticeLines`). */
  notices: FlowNoticeLabels;
}

export const russianFlowLabels: FlowLabels = {
  editor: russianFlowEditorLabels,
  clientCard: russianClientCardLabels,
  migrate: russianFlowMigrateLabels,
  testChat: russianFlowTestChatLabels,
  notices: russianFlowNoticeLabels,
};

export const englishFlowLabels: FlowLabels = {
  editor: englishFlowEditorLabels,
  clientCard: englishClientCardLabels,
  migrate: englishFlowMigrateLabels,
  testChat: englishFlowTestChatLabels,
  notices: englishFlowNoticeLabels,
};

export type { ClientCardLabels, FlowEditorLabels, FlowMigrateLabels, FlowNoticeLabels, FlowTestChatLabels };
export { englishFlowNoticeLabels, russianFlowNoticeLabels };
