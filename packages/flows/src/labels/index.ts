import { englishClientCardLabels, russianClientCardLabels, type ClientCardLabels } from "./client-card";
import { englishFlowEditorLabels, russianFlowEditorLabels, type FlowEditorLabels } from "./editor";
import { englishFlowMigrateLabels, russianFlowMigrateLabels, type FlowMigrateLabels } from "./migrate";
import { englishFlowTestChatLabels, russianFlowTestChatLabels, type FlowTestChatLabels } from "./test-chat";

/** Все надписи экранов сценария: по словарю на экран. */
export interface FlowLabels {
  editor: FlowEditorLabels;
  clientCard: ClientCardLabels;
  migrate: FlowMigrateLabels;
  testChat: FlowTestChatLabels;
}

export const russianFlowLabels: FlowLabels = {
  editor: russianFlowEditorLabels,
  clientCard: russianClientCardLabels,
  migrate: russianFlowMigrateLabels,
  testChat: russianFlowTestChatLabels,
};

export const englishFlowLabels: FlowLabels = {
  editor: englishFlowEditorLabels,
  clientCard: englishClientCardLabels,
  migrate: englishFlowMigrateLabels,
  testChat: englishFlowTestChatLabels,
};

export type { ClientCardLabels, FlowEditorLabels, FlowMigrateLabels, FlowTestChatLabels };
