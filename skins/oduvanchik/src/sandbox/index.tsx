/** Admin-only entry: never imported by the ordinary skin root or /chat. */
import { AgentSandbox as HeadlessAgentSandbox } from "@ykurilov/agent-chat-sandbox/react";
import type { AgentSandboxProps as HeadlessAgentSandboxProps, SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { oduvanchikSkin } from "../index";
import { OduvanchikSandboxLayout, OduvanchikStudioWorkspace } from "./layout";
import { OduvanchikJournalList } from "./journal";
import { OduvanchikModelCallDetails, OduvanchikToolCallDetails } from "./call-details";
import { OduvanchikAnswerEditor, OduvanchikChatReopen, OduvanchikInstructionEditor } from "./editors";
import { OduvanchikPeopleChats, OduvanchikSandboxSections } from "./people-chats";

export const oduvanchikSandboxSkin: SandboxSkin = {
  SandboxLayout: OduvanchikSandboxLayout,
  JournalList: OduvanchikJournalList,
  ModelCallDetails: OduvanchikModelCallDetails,
  ToolCallDetails: OduvanchikToolCallDetails,
  InstructionEditor: OduvanchikInstructionEditor,
  AnswerEditor: OduvanchikAnswerEditor,
  ChatReopen: OduvanchikChatReopen,
  SandboxSections: OduvanchikSandboxSections,
  PeopleChats: OduvanchikPeopleChats,
};
export const oduvanchikStudioChatListSkin = { ChatWorkspace: OduvanchikStudioWorkspace, ChatList: oduvanchikSkin.ChatList };
export type AgentSandboxProps = Omit<HeadlessAgentSandboxProps, "skin" | "sandboxSkin" | "chatListSkin"> & Partial<Pick<HeadlessAgentSandboxProps, "skin" | "sandboxSkin" | "chatListSkin">>;
export function AgentSandbox({ skin = oduvanchikSkin, sandboxSkin = oduvanchikSandboxSkin, chatListSkin = oduvanchikStudioChatListSkin, ...props }: AgentSandboxProps) {
  return <HeadlessAgentSandbox {...props} skin={skin} sandboxSkin={sandboxSkin} chatListSkin={chatListSkin} />;
}
