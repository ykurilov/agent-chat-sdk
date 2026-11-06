import { Textarea } from "@ykurilov/ds-react";
import React from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@tandem/ui";
import { AgentChat } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";
document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") ?? "light";
createRoot(document.getElementById("root")!).render(<TooltipProvider><main className="oduvanchik-chat" style={{ height: "100dvh", maxWidth: 720, margin: "auto" }}>
  <AgentChat api="/edit-fixture" chatId="one" skin={oduvanchikSkin} answerEditor={{ renderFields: ({ data, setData, disabled }) => <Textarea label="Почему так лучше" disabled={disabled} value={String(data.why ?? "")} onChange={e => setData({ why: e.target.value })} /> }} />
</main></TooltipProvider>);
