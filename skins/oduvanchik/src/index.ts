import type { ChatListSkin, ChatSkin, MemorySkin } from "@ykurilov/agent-chat-react";
import type { AgentPanelSkin } from "@ykurilov/agent-chat-react/panel";
import { OduvanchikAgentPanel, OduvanchikAgentPanelLauncher } from "./agent-panel";
import { OduvanchikAgentMessage } from "./agent-message";
import { OduvanchikBranchSwitcher } from "./branch-switcher";
import { OduvanchikAgentText } from "./agent-text";
import { OduvanchikChatList } from "./chat-list";
import { OduvanchikChatNotFound } from "./chat-not-found";
import { OduvanchikChatWorkspace } from "./chat-workspace";
import { OduvanchikCompactionDivider } from "./compaction-divider";
import { OduvanchikServiceLine } from "./service-line";
import { OduvanchikDiagram, oduvanchikDiagramColors } from "./diagram";
import { OduvanchikLiveDemo, oduvanchikDemoColors } from "./live-demo";
import { OduvanchikComposer } from "./composer";
import { OduvanchikConnectionNotice } from "./connection-notice";
import { OduvanchikErrorNotice } from "./error-notice";
import { OduvanchikChatClosedNotice } from "./chat-closed-notice";
import { OduvanchikLayout } from "./layout";
import { OduvanchikMemoryConfirm } from "./memory-confirm";
import { OduvanchikMemoryGroup } from "./memory-group";
import { OduvanchikMemoryMerge } from "./memory-merge";
import { OduvanchikMemoryNoteEditor } from "./memory-note-editor";
import { OduvanchikMemoryNoteRow } from "./memory-note-row";
import { OduvanchikMemoryScreen } from "./memory-screen";
import { OduvanchikMediaViewer } from "./media-viewer";
import { OduvanchikGeneratedImages } from "./generated-images";
import { OduvanchikAgentVideo } from "./agent-video";
import { OduvanchikMessageEditor } from "./message-editor";
import { OduvanchikReasoning } from "./reasoning";
import { OduvanchikSpendingNotice } from "./spending-notice";
import { OduvanchikToolCallRow } from "./tool-call-row";
import { OduvanchikUserMessage } from "./user-message";
import { OduvanchikInterruptMark } from "./interrupt-mark";
import { OduvanchikVoiceButton } from "./voice-button";
import { OduvanchikVoiceDialogButton } from "./voice-dialog-button";
import { OduvanchikVoiceDialogPanel } from "./voice-dialog-panel";
import { OduvanchikVoiceMenu } from "./voice-menu";
import { OduvanchikSuggestedReplies } from "./widgets/suggested-replies";
import { OduvanchikWidget } from "./widgets/widget";
import { oduvanchikWorkParts } from "./work-parts";

export const oduvanchikSkin: ChatSkin & ChatListSkin & AgentPanelSkin = {
  Layout: OduvanchikLayout,
  UserMessage: OduvanchikUserMessage,
  BranchSwitcher: OduvanchikBranchSwitcher,
  MessageEditor: OduvanchikMessageEditor,
  AgentMessage: OduvanchikAgentMessage,
  AgentText: OduvanchikAgentText,
  Reasoning: OduvanchikReasoning,
  ToolCallRow: OduvanchikToolCallRow,
  ConnectionNotice: OduvanchikConnectionNotice,
  SpendingNotice: OduvanchikSpendingNotice,
  ChatClosedNotice: OduvanchikChatClosedNotice,
  ErrorNotice: OduvanchikErrorNotice,
  CompactionDivider: OduvanchikCompactionDivider,
  ServiceLine: OduvanchikServiceLine,
  ChatNotFound: OduvanchikChatNotFound,
  Composer: OduvanchikComposer,
  ChatWorkspace: OduvanchikChatWorkspace,
  ChatList: OduvanchikChatList,
  AgentPanelLauncher: OduvanchikAgentPanelLauncher,
  AgentPanel: OduvanchikAgentPanel,
  MediaViewer: OduvanchikMediaViewer,
  Widget: OduvanchikWidget,
  SuggestedReplies: OduvanchikSuggestedReplies,
  diagramColors: oduvanchikDiagramColors,
  demoColors: oduvanchikDemoColors,
  GeneratedImages: OduvanchikGeneratedImages,
  AgentVideo: OduvanchikAgentVideo,
  ...oduvanchikWorkParts,
};

/** Части договора v18 по отдельности — с обязательными типами, для галереи и своих сборок скина. */
export { oduvanchikWorkParts };

/** Скин экрана памяти (договор скина, версия 11): отдельно от `oduvanchikSkin`, для `AgentMemory`. */
export const oduvanchikMemorySkin: MemorySkin = {
  MemoryScreen: OduvanchikMemoryScreen,
  MemoryGroup: OduvanchikMemoryGroup,
  MemoryNoteRow: OduvanchikMemoryNoteRow,
  MemoryNoteEditor: OduvanchikMemoryNoteEditor,
  MemoryMerge: OduvanchikMemoryMerge,
  MemoryConfirm: OduvanchikMemoryConfirm,
};

export {
  OduvanchikAgentMessage,
  OduvanchikAgentPanel,
  OduvanchikAgentPanelLauncher,
  OduvanchikAgentText,
  OduvanchikAgentVideo,
  OduvanchikBranchSwitcher,
  OduvanchikChatList,
  OduvanchikChatNotFound,
  OduvanchikChatWorkspace,
  OduvanchikCompactionDivider,
  OduvanchikServiceLine,
  OduvanchikComposer,
  OduvanchikConnectionNotice,
  OduvanchikDiagram,
  OduvanchikLiveDemo,
  OduvanchikErrorNotice,
  OduvanchikChatClosedNotice,
  OduvanchikGeneratedImages,
  OduvanchikInterruptMark,
  OduvanchikLayout,
  OduvanchikMediaViewer,
  OduvanchikMemoryConfirm,
  OduvanchikMemoryGroup,
  OduvanchikMemoryMerge,
  OduvanchikMemoryNoteEditor,
  OduvanchikMemoryNoteRow,
  OduvanchikMemoryScreen,
  OduvanchikMessageEditor,
  OduvanchikReasoning,
  OduvanchikSpendingNotice,
  OduvanchikSuggestedReplies,
  OduvanchikToolCallRow,
  OduvanchikUserMessage,
  OduvanchikVoiceButton,
  OduvanchikVoiceDialogButton,
  OduvanchikVoiceDialogPanel,
  OduvanchikVoiceMenu,
  OduvanchikWidget,
  oduvanchikDiagramColors,
  oduvanchikDemoColors,
};

export { Sphere as OduvanchikSphere } from "@ykurilov/ds-react";
export { OduvanchikWelcome } from "./welcome";
