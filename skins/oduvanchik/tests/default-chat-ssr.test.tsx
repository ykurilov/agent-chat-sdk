// @vitest-environment node
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentPanelProvider } from "@ykurilov/agent-chat-react/panel";
import { AgentChat, AgentPanel, ChatWorkspace } from "@ykurilov/agent-chat-skin-oduvanchik/chat";

describe("standard UI server rendering", () => {
  it("imports and renders without browser globals or CSS side effects", () => {
    expect(typeof window).toBe("undefined");
    expect(renderToString(createElement(AgentChat, { api: "/api/chat", chatId: "c1", header: { title: "Server header" } }))).toContain("oduvanchik-chat");
    expect(renderToString(createElement(ChatWorkspace, { api: "/api/chat" }))).toBeTruthy();
    expect(renderToString(createElement(AgentPanelProvider, { api: "/api/chat", userKey: "ssr", children: createElement(AgentPanel) }))).toBeTruthy();
  });
});
