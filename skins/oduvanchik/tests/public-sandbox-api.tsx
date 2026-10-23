import { AgentSandbox, oduvanchikSandboxSkin, oduvanchikStudioChatListSkin } from "@ykurilov/agent-chat-skin-oduvanchik/sandbox";
import type { AgentSandboxProps } from "@ykurilov/agent-chat-skin-oduvanchik/sandbox";
import { AgentSandbox as HeadlessAgentSandbox } from "@ykurilov/agent-chat-sandbox/react";
import type { AgentSandboxProps as HeadlessProps } from "@ykurilov/agent-chat-sandbox/react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";
const defaults: AgentSandboxProps = { basePath: "/api/sandbox", people: true, chatProps: { composerOptions: { variant: "extended" } } };
<AgentSandbox {...defaults} />;
declare const explicit: HeadlessProps;
<AgentSandbox {...explicit} />;
<HeadlessAgentSandbox skin={oduvanchikSkin} sandboxSkin={oduvanchikSandboxSkin} chatListSkin={oduvanchikStudioChatListSkin} />;
// @ts-expect-error The headless sandbox keeps its explicit skin contract.
<HeadlessAgentSandbox />;
