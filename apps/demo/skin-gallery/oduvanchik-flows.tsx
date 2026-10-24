import { AgentChat } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { oduvanchikFlowEditorSkin } from "@ykurilov/agent-chat-skin-oduvanchik/flows";
import { FlowTestChat, FlowLabelsProvider, type FlowTestChatConnection } from "@ykurilov/agent-chat-flows/react";
import { englishFlowLabels, russianFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { parseFlow, type AgentFlow } from "@ykurilov/agent-chat-flows/format";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import common from "../../../packages/flows/tests/fixtures/any-state-settings.json";
import days from "../flow-test-chat/marathon-days.json";
import "./oduvanchik-flows.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.lang = params.get("lang") === "en" ? "en" : "ru";
const fixture = params.get("flow") === "days" ? days : common;
const storageKey = `oduvanchik-flow-gallery:${params.get("flow") ?? "common"}`;
const parsed = parseFlow(JSON.parse(localStorage.getItem(storageKey) ?? JSON.stringify(fixture)));
if (!parsed.ok) throw new Error("Invalid gallery fixture");
const initial: AgentFlow = parsed.flow;
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw Object.assign(new Error(`${path}: ${response.status}`), await response.json().catch(() => ({})));
  return response.json() as Promise<T>;
}
const testChat: FlowTestChatConnection = {
  start: (flow) => post("/api/flow-test/start", { flow }),
  advance: (chatId, ms) => post("/api/flow-test/advance", { chatId, ms }),
  advanceToNextDay: (chatId) => post("/api/flow-test/advance", { chatId, to: "next_day_start" }),
  advanceToNextFirstMessage: (chatId) => post("/api/flow-test/advance", { chatId, to: "next_first_message" }),
  readRun: (chatId) => post("/api/flow-test/run", { chatId }),
  renderChat: (chatId, { noticeLines }) => <AgentChat api="/api/chat" chatId={chatId} noticeLines={noticeLines} />,
};
function Gallery() {
  const [flow, setFlow] = useState(initial);
  const [saved, setSaved] = useState(initial);
  return <FlowLabelsProvider labels={params.get("lang") === "en" ? englishFlowLabels : russianFlowLabels}>
    <FlowTestChat value={flow} savedValue={saved} onChange={setFlow} skin={oduvanchikFlowEditorSkin}
      header={params.get("header") === "full" ? "full" : "compact"} inspector="collapsible" minimap="collapsed" fullscreen storageKey="oduvanchik-flow-board"
      readOnly={params.get("readonly") === "1"} testChat={testChat}
      onSave={async (next) => { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); return { ok: true }; }}
      catalog={{ tools: ["finish_dialog", "check_answer", "show_example"], events: ["booking_link"], widgets: [] }}
      checks={params.get("issues") === "1" ? () => [{ path: "anyState.exits[0]", message: "Gallery validation", level: "error" }] : undefined}
      timeZone="Europe/Moscow" />
  </FlowLabelsProvider>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
