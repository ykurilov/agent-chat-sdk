import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { TandemAnswerEditor } from "./answer-editor";
import { TandemModelCallDetails, TandemToolCallDetails } from "./call-details";
import { TandemChatReopen } from "./chat-reopen";
import { TandemInstructionEditor } from "./instruction-editor";
import { TandemJournalList } from "./journal-list";
import { TandemPeopleChats, TandemSandboxSections } from "./people-chats";
import { TandemSandboxLayout } from "./sandbox-layout";

/** Скин песочницы (договор скина песочницы, версия 1, с разделом «Чаты людей»): для `AgentSandbox`. */
export const tandemSandboxSkin: SandboxSkin = {
  SandboxLayout: TandemSandboxLayout,
  JournalList: TandemJournalList,
  ModelCallDetails: TandemModelCallDetails,
  ToolCallDetails: TandemToolCallDetails,
  InstructionEditor: TandemInstructionEditor,
  AnswerEditor: TandemAnswerEditor,
  SandboxSections: TandemSandboxSections,
  PeopleChats: TandemPeopleChats,
  ChatReopen: TandemChatReopen,
};
