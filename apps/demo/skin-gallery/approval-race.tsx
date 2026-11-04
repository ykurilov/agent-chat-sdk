import { AgentChat, ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";
import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
import { TooltipProvider } from "@tandem/ui";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import "./compact-history.css";

// Управляемый поток позволяет нажать карточку до finish, без платного провайдера и таймерных гонок.
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const nativeFetch = globalThis.fetch;
let finish = () => {};
let recordDecision = (_decision: string) => {};
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("/approval-fixture")) return nativeFetch(input, init);
  const path = new URL(url, location.href).pathname;
  if (path.endsWith("/messages")) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      const push = (chunk: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      push({ type: "start", messageId: "a1" });
      push({ type: "start-step" });
      push({ type: "tool-input-available", toolCallId: "call-1", toolName: "launch_plan", title: "Запустить план", input: { plan: "Проверочный план" } });
      push({ type: "tool-approval-request", approvalId: "ap1", toolCallId: "call-1" });
      finish = () => {
        push({ type: "finish-step" });
        push({ type: "message-metadata", messageMetadata: { status: "awaiting_approval" } });
        push({ type: "finish" });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        finish = () => {};
      };
    } });
    return new Response(body, { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
  }
  if (path.includes("/approvals/")) {
    recordDecision(JSON.parse(String(init?.body)).decision);
    return Response.json({ resumed: false });
  }
  if (path.endsWith("/stream")) return new Response(null, { status: 204 });
  if (path.endsWith("/c1")) return Response.json({ chat: { id: "c1" }, messages: [], running: false, compactions: [], forks: [] });
  return Response.json({ error: { kind: "not_found" } }, { status: 404 });
};
function Fixture() {
  const [decisions, setDecisions] = useState<string[]>([]);
  recordDecision = (decision) => setDecisions((old) => [...old, decision]);
  return <TooltipProvider><ChatLabelsProvider labels={russianLabels}>
    <button onClick={() => finish()}>Закончить ход стенда</button>
    <output data-decisions={decisions.join(",")}>{decisions.length} решений</output>
    <div style={{ height: "calc(100dvh - 32px)" }}><AgentChat api="/approval-fixture" chatId="c1" workView="detailed" skin={params.get("skin") === "tandem" ? tandemSkin : oduvanchikSkin} /></div>
  </ChatLabelsProvider></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
