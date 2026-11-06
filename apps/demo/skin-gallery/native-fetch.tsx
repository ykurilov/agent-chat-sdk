import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@tandem/ui";
import { attachmentsClient } from "@ykurilov/agent-chat-attachments/react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";
import type { ServerFileResult } from "@ykurilov/agent-chat-react";
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";

// Deliberately keep the real Window.fetch. Playwright intercepts HTTP, not the JavaScript function.
document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") ?? "light";
const Composer = oduvanchikSkin.Composer;
function Fixture() {
  const [chatId, setChatId] = useState("one");
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [finish, setFinish] = useState<(() => void) | null>(null);
  const controller = attachmentsClient.useController({ api: "/native-files", chatId, modelSeesImages: true });
  const addServer = () => controller.addServerFiles!([{ name: "server.png", ingest: () => new Promise<ServerFileResult>((resolve) => {
    // Ignore abort to exercise cleanup of an ingest that completes after removal/chat switch.
    setFinish(() => () => resolve({ ok: true, attachment: { id: "server-id", name: "server.png", mediaType: "image/png", kind: "image", size: 10 } }));
  }) }]);
  return <TooltipProvider><div className="oduvanchik-chat" style={{ padding: 20, maxWidth: 420 }}>
    <button onClick={addServer}>Добавить серверный файл</button><button onClick={() => finish?.()}>Завершить ingest</button>
    <button onClick={() => setChatId("two")}>Другой чат</button>
    <output data-chat={chatId} data-ready={controller.ready} data-items={controller.composer.items.length}>{submitted}</output>
    <Composer value={value} onValueChange={setValue} onSubmit={() => setSubmitted(JSON.stringify(controller.readFiles()))} canSubmit={controller.ready && controller.hasFiles} busy={false} onStop={() => {}} attachments={controller.composer} />
  </div></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
