import { FlowEditor, FlowLabelsProvider, russianFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { parseFlow, type AgentFlow } from "@ykurilov/agent-chat-flows/format";
import { tandemFlowEditorSkin } from "@ykurilov/agent-chat-skin-tandem/flows";
import { oduvanchikFlowEditorSkin } from "@ykurilov/agent-chat-skin-oduvanchik/flows";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import fixture from "../../../packages/flows/tests/fixtures/sales-review.json";
const params = new URLSearchParams(location.search);
const oduvanchik = params.get("skin") === "oduvanchik";
if (oduvanchik) await import("./oduvanchik-flows.css"); else await import("../src/styles.css");
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
const parsed = parseFlow(fixture);
if (!parsed.ok) throw new Error("Invalid fixture");
const initial: AgentFlow = { ...parsed.flow, tools: [...parsed.flow.tools, "sale_answer", "person_link_view", "finish_dialog"], states: parsed.flow.states.map(state => state.id === "intro" ? { ...state, tools: ["sale_answer"] } : state) };
const labels = { ...russianFlowLabels, editor: { ...russianFlowLabels.editor, statePanel: { ...russianFlowLabels.editor.statePanel, tagsHint: "Подсказка меток приложения", noSideQuestionsHint: "Подсказка вопросов приложения" } } };
function Gallery() {
  const [value, onChange] = useState(initial);
  return <FlowLabelsProvider labels={labels}><div style={{ height: "100dvh" }}><FlowEditor skin={oduvanchik ? oduvanchikFlowEditorSkin : tandemFlowEditorSkin} value={value} onChange={onChange} onSave={() => {}} catalog={{ tools: initial.tools, events: ["booking_link"], widgets: [], toolLabels: { give_booking_link: "Ссылка на запись", call_expert: "Связаться с экспертом", sale_answer: "Инструмент ответа", person_link_view: "Инструмент ссылки", finish_dialog: "Инструмент завершения" } }} storageKey={null} header="compact" minimap="collapsed" timeZone="UTC" /></div></FlowLabelsProvider>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
