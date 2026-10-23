import { AgentChat, AgentPanel, ChatWorkspace } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import type { AgentChatProps, AgentPanelProps, ChatWorkspaceProps } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { AgentChat as HeadlessAgentChat } from "@ykurilov/agent-chat-react";
import type { AgentChatProps as HeadlessChatProps } from "@ykurilov/agent-chat-react";
import type { AgentPanelProps as HeadlessPanelProps } from "@ykurilov/agent-chat-react/panel";
import type { ChatWorkspaceProps as HeadlessWorkspaceProps } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";

declare const chat: HeadlessChatProps;
declare const panel: HeadlessPanelProps;
declare const workspace: HeadlessWorkspaceProps;
const defaults: [AgentChatProps, AgentPanelProps, ChatWorkspaceProps] = [{ api: "/api/chat", chatId: "c1" }, {}, { api: "/api/chat" }];
<AgentChat {...defaults[0]} />;
<AgentPanel {...defaults[1]} />;
<ChatWorkspace {...defaults[2]} />;
<AgentChat {...chat} />;
<AgentPanel {...panel} />;
<ChatWorkspace {...workspace} />;
<HeadlessAgentChat api="/api/chat" chatId="c1" skin={oduvanchikSkin} />;
// @ts-expect-error The headless entry still requires explicit skin.
<HeadlessAgentChat api="/api/chat" chatId="c1" />;

import { ChatProgress, CompletionCard } from "@ykurilov/ds-react";
import type { ChatHeaderView } from "@ykurilov/agent-chat-react";
const header: ChatHeaderView = {title:"Application",aside:<ChatProgress label="Progress" value={1} max={2}/>,headingLevel:2};
<AgentChat api="/api/chat" chatId="c1" header={header} completion={<CompletionCard title="Application result" action={<button>Continue</button>}/>}/>;
