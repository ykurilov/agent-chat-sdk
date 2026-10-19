import type { ChatListSkin, ChatSkin, MemorySkin } from "@ykurilov/agent-chat-react";
import type { AgentPanelSkin } from "@ykurilov/agent-chat-react/panel";
import { TandemAgentPanel, TandemAgentPanelLauncher } from "./agent-panel";
import { TandemAgentMessage } from "./agent-message";
import { TandemBranchSwitcher } from "./branch-switcher";
import { TandemAgentText } from "./agent-text";
import { TandemChatList } from "./chat-list";
import { TandemChatNotFound } from "./chat-not-found";
import { TandemChatWorkspace } from "./chat-workspace";
import { TandemCompactionDivider } from "./compaction-divider";
import { TandemServiceLine } from "./service-line";
import { TandemDiagram, tandemDiagramColors } from "./diagram";
import { TandemLiveDemo, tandemDemoColors } from "./live-demo";
import { TandemComposer } from "./composer";
import { TandemConnectionNotice } from "./connection-notice";
import { TandemErrorNotice } from "./error-notice";
import { TandemChatClosedNotice } from "./chat-closed-notice";
import { TandemLayout } from "./layout";
import { TandemMemoryConfirm } from "./memory-confirm";
import { TandemMemoryGroup } from "./memory-group";
import { TandemMemoryMerge } from "./memory-merge";
import { TandemMemoryNoteEditor } from "./memory-note-editor";
import { TandemMemoryNoteRow } from "./memory-note-row";
import { TandemMemoryScreen } from "./memory-screen";
import { TandemMediaViewer } from "./media-viewer";
import { TandemGeneratedImages } from "./generated-images";
import { TandemAgentVideo } from "./agent-video";
import { TandemMessageEditor } from "./message-editor";
import { TandemReasoning } from "./reasoning";
import { TandemSpendingNotice } from "./spending-notice";
import { TandemToolCallRow } from "./tool-call-row";
import { TandemUserMessage } from "./user-message";
import { TandemInterruptMark } from "./interrupt-mark";
import { TandemVoiceButton } from "./voice-button";
import { TandemVoiceDialogButton } from "./voice-dialog-button";
import { TandemVoiceDialogPanel } from "./voice-dialog-panel";
import { TandemVoiceMenu } from "./voice-menu";
import { TandemSuggestedReplies } from "./widgets/suggested-replies";
import { TandemWidget } from "./widgets/widget";
import { tandemWorkParts } from "./work-parts";

export const tandemSkin: ChatSkin & ChatListSkin & AgentPanelSkin = {
  Layout: TandemLayout,
  UserMessage: TandemUserMessage,
  BranchSwitcher: TandemBranchSwitcher,
  MessageEditor: TandemMessageEditor,
  AgentMessage: TandemAgentMessage,
  AgentText: TandemAgentText,
  Reasoning: TandemReasoning,
  ToolCallRow: TandemToolCallRow,
  ConnectionNotice: TandemConnectionNotice,
  SpendingNotice: TandemSpendingNotice,
  ChatClosedNotice: TandemChatClosedNotice,
  ErrorNotice: TandemErrorNotice,
  CompactionDivider: TandemCompactionDivider,
  ServiceLine: TandemServiceLine,
  ChatNotFound: TandemChatNotFound,
  Composer: TandemComposer,
  ChatWorkspace: TandemChatWorkspace,
  ChatList: TandemChatList,
  AgentPanelLauncher: TandemAgentPanelLauncher,
  AgentPanel: TandemAgentPanel,
  MediaViewer: TandemMediaViewer,
  Widget: TandemWidget,
  SuggestedReplies: TandemSuggestedReplies,
  diagramColors: tandemDiagramColors,
  demoColors: tandemDemoColors,
  steering: true,
  GeneratedImages: TandemGeneratedImages,
  AgentVideo: TandemAgentVideo,
  ...tandemWorkParts,
};

/** Части договора v18 по отдельности — с обязательными типами, для галереи и своих сборок скина. */
export { tandemWorkParts };

/** Скин экрана памяти (договор скина, версия 11): отдельно от `tandemSkin`, для `AgentMemory`. */
export const tandemMemorySkin: MemorySkin = {
  MemoryScreen: TandemMemoryScreen,
  MemoryGroup: TandemMemoryGroup,
  MemoryNoteRow: TandemMemoryNoteRow,
  MemoryNoteEditor: TandemMemoryNoteEditor,
  MemoryMerge: TandemMemoryMerge,
  MemoryConfirm: TandemMemoryConfirm,
};

export {
  TandemAgentMessage,
  TandemAgentPanel,
  TandemAgentPanelLauncher,
  TandemAgentText,
  TandemAgentVideo,
  TandemBranchSwitcher,
  TandemChatList,
  TandemChatNotFound,
  TandemChatWorkspace,
  TandemCompactionDivider,
  TandemServiceLine,
  TandemComposer,
  TandemConnectionNotice,
  TandemDiagram,
  TandemLiveDemo,
  TandemErrorNotice,
  TandemChatClosedNotice,
  TandemGeneratedImages,
  TandemInterruptMark,
  TandemLayout,
  TandemMediaViewer,
  TandemMemoryConfirm,
  TandemMemoryGroup,
  TandemMemoryMerge,
  TandemMemoryNoteEditor,
  TandemMemoryNoteRow,
  TandemMemoryScreen,
  TandemMessageEditor,
  TandemReasoning,
  TandemSpendingNotice,
  TandemSuggestedReplies,
  TandemToolCallRow,
  TandemUserMessage,
  TandemVoiceButton,
  TandemVoiceDialogButton,
  TandemVoiceDialogPanel,
  TandemVoiceMenu,
  TandemWidget,
  tandemDiagramColors,
  tandemDemoColors,
};
