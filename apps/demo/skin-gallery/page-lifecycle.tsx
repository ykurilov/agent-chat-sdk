import React from "react";
import { createRoot } from "react-dom/client";
import { AgentChat } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";
const params = new URLSearchParams(location.search);
const pending = params.has("pending");
const generation = params.get("generation");
createRoot(document.getElementById("root")!).render(<div style={{ height: "100dvh" }}><AgentChat api={generation ? "/page-generation" : "/page-lifecycle-api"} chatId={generation ?? (params.has("pendingAnswer") ? "pending-answer" : pending ? "pending" : "normal")} composerOptions={{ variant: "compact" }} /></div>);
