// @vitest-environment node
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { AgentSandbox } from "@ykurilov/agent-chat-skin-oduvanchik/sandbox";
it("imports the optional sandbox entry and renders without browser globals", () => {
  expect(typeof window).toBe("undefined");
  expect(renderToString(createElement(AgentSandbox))).toContain("yk-studio");
});
