import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AgentSandbox } from "@ykurilov/agent-chat-skin-oduvanchik/sandbox";
assert.equal(typeof window, "undefined");
assert.match(renderToString(createElement(AgentSandbox)), /yk-studio/);
console.log("Built sandbox entry + plain Node SSR: PASS");
