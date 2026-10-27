/** Standard chat UI. This entry depends on the headless React package, never the reverse. */
import { AgentChat as HeadlessAgentChat, ChatWorkspace as HeadlessChatWorkspace } from "@ykurilov/agent-chat-react";
import type { AgentChatProps as HeadlessAgentChatProps, ChatWorkspaceProps as HeadlessChatWorkspaceProps } from "@ykurilov/agent-chat-react";
import { AgentPanel as HeadlessAgentPanel } from "@ykurilov/agent-chat-react/panel";
import type { AgentPanelProps as HeadlessAgentPanelProps } from "@ykurilov/agent-chat-react/panel";
import { oduvanchikSkin } from "./index";

export type AgentChatProps = Omit<HeadlessAgentChatProps, "skin"> & { skin?: HeadlessAgentChatProps["skin"] };
export type ChatWorkspaceProps = Omit<HeadlessChatWorkspaceProps, "skin"> & { skin?: HeadlessChatWorkspaceProps["skin"] };
export type AgentPanelProps = Omit<HeadlessAgentPanelProps, "skin"> & { skin?: HeadlessAgentPanelProps["skin"] };

export function AgentChat({ skin = oduvanchikSkin, ...props }: AgentChatProps) {
  return <HeadlessAgentChat {...props} skin={skin} />;
}

export function ChatWorkspace({ skin = oduvanchikSkin, ...props }: ChatWorkspaceProps) {
  return <HeadlessChatWorkspace {...props} skin={skin} />;
}

export function AgentPanel({ skin = oduvanchikSkin, ...props }: AgentPanelProps) {
  return <HeadlessAgentPanel {...props} skin={skin} />;
}

export { ChatAppViewport } from "@ykurilov/agent-chat-react";
export type { ChatAppViewportProps } from "@ykurilov/agent-chat-react";
