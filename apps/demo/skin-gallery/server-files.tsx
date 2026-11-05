import React from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@tandem/ui";
import { useComposerHelper } from "@ykurilov/agent-chat-react";
import { AgentPanel, AgentPanelProvider, useAgentPanel } from "@ykurilov/agent-chat-react/panel";
import { attachmentsClient } from "@ykurilov/agent-chat-attachments/react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";
import type { ServerFileResult } from "@ykurilov/agent-chat-react";
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";

const theme = new URLSearchParams(location.search).get("theme") ?? "light";
document.documentElement.dataset.theme = theme;
const stats = { uploads: 0, posts: [] as unknown[], deleted: [] as string[], ingests: 0, customDrops: 0 };
Object.assign(window, { attachmentStats: stats });
let finish: (() => void) | undefined;
const preview = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#999"/></svg>');
const draft = () => ({ name: "library.png", previewUrl: preview, ingest: (signal: AbortSignal) => new Promise<ServerFileResult>((resolve, reject) => {
  stats.ingests++;
  signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  finish = () => resolve({ ok: true, attachment: { id: "server-file", name: "library.png", mediaType: "image/png", kind: "image", size: 100 } });
}) });
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input), location.href);
  if (!url.pathname.startsWith("/files-fixture")) return nativeFetch(input, init);
  const path = url.pathname;
  if (path.endsWith("/attachments/settings")) return Response.json({ maxFiles: 10, maxFileBytes: 20 * 1024 * 1024, maxMessageTextTokens: 100000, accept: "image/png" });
  if (init?.method === "DELETE") { stats.deleted.push(path); return new Response(null, { status: 204 }); }
  if (path.endsWith("/attachments") && init?.method === "POST") { stats.uploads++; return Response.json({ id: "device-file", name: "device.png", mediaType: "image/png", kind: "image", size: 100 }); }
  if (path.endsWith("/messages")) {
    stats.posts.push(JSON.parse(String(init?.body)));
    const chunks = [{ type: "start", messageId: "answer" }, { type: "start-step" }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Принято" }, { type: "text-end", id: "t" }, { type: "finish-step" }, { type: "finish" }];
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
  }
  if (path.endsWith("/stream")) return new Response(null, { status: 204 });
  if (path === "/files-fixture") return Response.json({ chats: [{ id: "c1", title: "Чат с файлами", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  if (path.endsWith("/c1")) return Response.json({ chat: { id: "c1" }, messages: [], running: false, compactions: [], forks: [] });
  return Response.json({ error: { kind: "not_found" } }, { status: 404 });
};
function Controls() {
  const panel = useAgentPanel(); const field = useComposerHelper();
  return <div style={{ position: "fixed", left: 4, top: 4, zIndex: 1000 }}><button onClick={panel.showChat}>Открыть стенд</button><button onClick={() => finish?.()}>Завершить ingest</button><output data-field-ready={!!field?.canSend} /></div>;
}
const BasePanel = oduvanchikSkin.AgentPanel;
const BaseComposer = oduvanchikSkin.Composer;
const skin: typeof oduvanchikSkin = {
  ...oduvanchikSkin,
  AgentPanel: (props) => {
    const field = useComposerHelper();
    return <BasePanel {...props}><div style={{ height: "100%" }} data-panel-drop onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("application/x-ykcreator-result")) event.preventDefault(); }} onDrop={(event) => {
      if (!event.defaultPrevented && event.dataTransfer.types.includes("application/x-ykcreator-result")) { event.preventDefault(); stats.customDrops++; field?.addServerFiles([draft()]); }
    }}>{props.children}</div></BasePanel>;
  },
  Composer: (props) => {
    const field = useComposerHelper();
    return <BaseComposer {...props} options={{ ...props.options, addMenu: { fromDevice: { label: "С компьютера" }, items: [{ id: "library", label: "Мои загрузки", onPick: () => field?.addServerFiles([draft()]) }] } }} />;
  },
};
createRoot(document.getElementById("root")!).render(<TooltipProvider><AgentPanelProvider api="/files-fixture" userKey="files-fixture"><Controls /><AgentPanel skin={skin} attachments={attachmentsClient} /></AgentPanelProvider></TooltipProvider>);
