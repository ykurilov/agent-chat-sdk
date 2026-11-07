import React, { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@tandem/ui";
import { AgentChat, createBrowserChatTransport } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";
document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") ?? "light";
function Fixture() {
  const transport = useMemo(() => createBrowserChatTransport({ endpoint: "/browser-chat-fixture", ownerId: "fixture-owner", chatId: "fixture-local", loadSnapshot: () => JSON.parse(localStorage.getItem("browser-chat-snapshot") ?? "null"), saveSnapshot: async snapshot => { await new Promise(resolve => setTimeout(resolve, 5)); localStorage.setItem("browser-chat-snapshot", JSON.stringify(snapshot)); } }), []);
  useEffect(() => () => transport.dispose(), [transport]);
  return <TooltipProvider><main style={{ height: "100dvh", background: "var(--yk-bg)", color: "var(--yk-text)" }}><AgentChat {...transport.chatProps} skin={oduvanchikSkin} composerOptions={{ variant: "extended" }} /></main></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
