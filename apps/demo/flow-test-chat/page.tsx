import { AgentChat } from "@ykurilov/agent-chat-react";
import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
import { parseFlow, type AgentFlow } from "@ykurilov/agent-chat-flows/format";
import { FlowTestChat, type FlowTestChatConnection } from "@ykurilov/agent-chat-flows/react";
import { tandemFlowEditorSkin } from "@ykurilov/agent-chat-skin-tandem/flows";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import salesReview from "../../../packages/flows/tests/fixtures/sales-review.json";
import marathonDays from "./marathon-days.json";
import "../src/styles.css";

/*
 * Стенд тестового чата (этап 10 плана 058): редактор сценария и чат приложения рядом. Адрес: theme=light|dark,
 * flow=days — сценарий по дням с кнопкой «К началу следующего дня».
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const parsed = parseFlow(params.get("flow") === "days" ? marathonDays : salesReview);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const initial: AgentFlow = parsed.flow;

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // Код ошибки сервера (`nothing_scheduled` у перемотки к напоминанию) — дальше, тестовому чату.
  if (!response.ok) throw Object.assign(new Error(`${path}: ${response.status}`), await response.json().catch(() => ({})));
  return (await response.json()) as T;
}

const testChat: FlowTestChatConnection = {
  start: (flow) => post("/api/flow-test/start", { flow }),
  advance: (chatId, ms) => post("/api/flow-test/advance", { chatId, ms }),
  advanceToNextDay: (chatId) => post("/api/flow-test/advance", { chatId, to: "next_day_start" }),
  advanceToNextFirstMessage: (chatId) => post("/api/flow-test/advance", { chatId, to: "next_first_message" }),
  readRun: (chatId) => post("/api/flow-test/run", { chatId }),
  // Строки «Агент написал первым — человек молчал 1 ч 7 мин»: сервер даёт тестовым чатам право `appNotices`.
  renderChat: (chatId, { noticeLines }) => <AgentChat api="/api/chat" chatId={chatId} skin={tandemSkin} noticeLines={noticeLines} />,
};

function Page() {
  const [flow, setFlow] = useState(initial);
  return (
    <div style={{ height: "100dvh" }}>
      <FlowTestChat
        skin={tandemFlowEditorSkin}
        value={flow}
        onChange={setFlow}
        catalog={{ tools: ["give_booking_link", "call_expert"], events: ["booking_link"], widgets: [] }}
        testChat={testChat}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
