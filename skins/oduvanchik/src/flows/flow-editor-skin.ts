import type { FlowEditorSkin } from "@ykurilov/agent-chat-flows/react";
import { OduvanchikFlowAnyStateNode, OduvanchikFlowBoardToggle, OduvanchikFlowEdge, OduvanchikFlowLegend, OduvanchikFlowStateNode, OduvanchikFlowZoomControls } from "./flow-board-parts";
import { OduvanchikFlowJsonDialog, OduvanchikFlowTestChatFrame } from "./flow-dialogs";
import { OduvanchikFlowExitCard } from "./flow-exit-card";
import { OduvanchikFlowEditorFrame, OduvanchikFlowHeader } from "./flow-frame";
import {
  OduvanchikFlowAnyStatePanel,
  OduvanchikFlowCardPanel,
  OduvanchikFlowCheckPanel,
  OduvanchikFlowFieldRow,
  OduvanchikFlowOverviewPanel,
  OduvanchikFlowStatePanel,
} from "./flow-panels";
import { OduvanchikFlowNudgesEditor, OduvanchikFlowScheduleSection, OduvanchikFlowSideTasksSection, OduvanchikFlowStateTiming } from "./flow-days";
import { OduvanchikFlowRunPanel } from "./flow-run-panel";
import { OduvanchikFlowMigrateDialog } from "./migrate-dialog";

/** Скин редактора сценария (договор `FlowEditorSkin` v1) по прототипу: для `FlowEditor`. */
export const oduvanchikFlowEditorSkin: FlowEditorSkin = {
  FlowEditorFrame: OduvanchikFlowEditorFrame,
  FlowHeader: OduvanchikFlowHeader,
  FlowStateNode: OduvanchikFlowStateNode,
  FlowAnyStateNode: OduvanchikFlowAnyStateNode,
  FlowEdge: OduvanchikFlowEdge,
  FlowLegend: OduvanchikFlowLegend,
  FlowZoomControls: OduvanchikFlowZoomControls,
  FlowBoardToggle: OduvanchikFlowBoardToggle,
  FlowOverviewPanel: OduvanchikFlowOverviewPanel,
  FlowStatePanel: OduvanchikFlowStatePanel,
  FlowAnyStatePanel: OduvanchikFlowAnyStatePanel,
  FlowExitCard: OduvanchikFlowExitCard,
  FlowCardPanel: OduvanchikFlowCardPanel,
  FlowFieldRow: OduvanchikFlowFieldRow,
  FlowCheckPanel: OduvanchikFlowCheckPanel,
  FlowRunPanel: OduvanchikFlowRunPanel,
  FlowJsonDialog: OduvanchikFlowJsonDialog,
  FlowMigrateDialog: OduvanchikFlowMigrateDialog,
  FlowTestChatFrame: OduvanchikFlowTestChatFrame,
  FlowScheduleSection: OduvanchikFlowScheduleSection,
  FlowSideTasksSection: OduvanchikFlowSideTasksSection,
  FlowStateTiming: OduvanchikFlowStateTiming,
  FlowNudgesEditor: OduvanchikFlowNudgesEditor,
};
