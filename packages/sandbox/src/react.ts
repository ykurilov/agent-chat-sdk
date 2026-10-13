// Вход `./react`: экран песочницы, договор её скина и надписи.
export { AgentSandbox } from "./react/agent-sandbox";
export type { AgentSandboxProps } from "./react/agent-sandbox";
export type {
  AnswerEditorToolOutputView,
  JournalModelRowView,
  JournalRowView,
  JournalToolRowView,
  JournalTurnView,
  ModelCallDetailsView,
  ModelCallMessageView,
  PeopleChatsView,
  PersonChatView,
  PersonView,
  SandboxLoadState,
  SandboxSection,
  SandboxSkin,
  ToolCallDetailsView,
} from "./react/sandbox-skin";
export {
  SandboxLabelsProvider,
  englishChatReopenLabels,
  englishPeopleChatsLabels,
  englishSandboxLabels,
  russianChatReopenLabels,
  russianPeopleChatsLabels,
  russianSandboxLabels,
  useChatReopenLabels,
  usePeopleChatsLabels,
  useSandboxLabels,
} from "./react/sandbox-labels";
export type { ChatReopenLabels, PeopleChatsLabels, SandboxLabels } from "./react/sandbox-labels";
