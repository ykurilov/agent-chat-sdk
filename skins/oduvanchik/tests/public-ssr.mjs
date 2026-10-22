// Run with plain Node after build: no source conditions, JSX transform or browser globals.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { AgentChat, AgentPanel, ChatWorkspace } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { AgentPanelProvider } from "@ykurilov/agent-chat-react/panel";

assert.equal(typeof window, "undefined");
assert.match(renderToString(h(AgentChat, { api: "/api/chat", chatId: "c1" })), /oduvanchik-chat/);
assert.ok(renderToString(h(ChatWorkspace, { api: "/api/chat" })));
assert.ok(renderToString(h(AgentPanelProvider, { api: "/api/chat", userKey: "ssr" }, h(AgentPanel))));
console.log("Built /chat exports + Node SSR: PASS");
