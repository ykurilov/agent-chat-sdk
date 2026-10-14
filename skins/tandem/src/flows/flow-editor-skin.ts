import type { FlowEditorSkin } from "@ykurilov/agent-chat-flows/react";
import { TandemFlowAnyStateNode, TandemFlowBoardToggle, TandemFlowEdge, TandemFlowLegend, TandemFlowStateNode, TandemFlowZoomControls } from "./flow-board-parts";
import { TandemFlowJsonDialog, TandemFlowTestChatFrame } from "./flow-dialogs";
import { TandemFlowExitCard } from "./flow-exit-card";
import { TandemFlowEditorFrame, TandemFlowHeader } from "./flow-frame";
import {
  TandemFlowAnyStatePanel,
  TandemFlowCardPanel,
  TandemFlowCheckPanel,
  TandemFlowFieldRow,
  TandemFlowOverviewPanel,
  TandemFlowStatePanel,
} from "./flow-panels";
import { TandemFlowNudgesEditor, TandemFlowScheduleSection, TandemFlowSideTasksSection, TandemFlowStateTiming } from "./flow-days";
import { TandemFlowRunPanel } from "./flow-run-panel";
import { TandemFlowMigrateDialog } from "./migrate-dialog";

/** Скин редактора сценария (договор `FlowEditorSkin` v1) по прототипу: для `FlowEditor`. */
export const tandemFlowEditorSkin: FlowEditorSkin = {
  FlowEditorFrame: TandemFlowEditorFrame,
  FlowHeader: TandemFlowHeader,
  FlowStateNode: TandemFlowStateNode,
  FlowAnyStateNode: TandemFlowAnyStateNode,
  FlowEdge: TandemFlowEdge,
  FlowLegend: TandemFlowLegend,
  FlowZoomControls: TandemFlowZoomControls,
  FlowBoardToggle: TandemFlowBoardToggle,
  FlowOverviewPanel: TandemFlowOverviewPanel,
  FlowStatePanel: TandemFlowStatePanel,
  FlowAnyStatePanel: TandemFlowAnyStatePanel,
  FlowExitCard: TandemFlowExitCard,
  FlowCardPanel: TandemFlowCardPanel,
  FlowFieldRow: TandemFlowFieldRow,
  FlowCheckPanel: TandemFlowCheckPanel,
  FlowRunPanel: TandemFlowRunPanel,
  FlowJsonDialog: TandemFlowJsonDialog,
  FlowMigrateDialog: TandemFlowMigrateDialog,
  FlowTestChatFrame: TandemFlowTestChatFrame,
  FlowScheduleSection: TandemFlowScheduleSection,
  FlowSideTasksSection: TandemFlowSideTasksSection,
  FlowStateTiming: TandemFlowStateTiming,
  FlowNudgesEditor: TandemFlowNudgesEditor,
};
