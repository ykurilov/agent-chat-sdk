import { attachmentsClient } from "@ykurilov/agent-chat-attachments/react";
import { diagramsClient } from "@ykurilov/agent-chat-diagrams";
import { imagesClient } from "@ykurilov/agent-chat-images/react";
import { AgentSandbox } from "@ykurilov/agent-chat-sandbox/react";
import { TandemChatNotFound, tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
import { tandemSandboxSkin } from "@ykurilov/agent-chat-skin-tandem/sandbox";
import { videosClient } from "@ykurilov/agent-chat-videos/react";
import { useEffect, useState } from "react";
import { demoWidgets } from "./chat-features";

const sandboxApi = "/api/sandbox";

/**
 * Страница песочницы агента. Доступ решает сервер: не админу он отвечает «не найдено» на любом адресе,
 * поэтому страница сначала спрашивает список чатов и по 404 показывает «не найдено».
 */
export default function SandboxPage() {
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  useEffect(() => {
    let cancelled = false;
    fetch(sandboxApi, { credentials: "same-origin" })
      .then((response) => !cancelled && setAccess(response.status === 404 ? "denied" : "allowed"))
      .catch(() => !cancelled && setAccess("allowed"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (access === "checking") return null;
  if (access === "denied") {
    return <TandemChatNotFound />;
  }
  return (
    <AgentSandbox
      basePath={sandboxApi}
      skin={tandemSkin}
      sandboxSkin={tandemSandboxSkin}
      chatListSkin={tandemSkin}
      chatProps={{
        attachments: attachmentsClient,
        widgets: demoWidgets,
        diagrams: diagramsClient,
        images: imagesClient,
        videos: videosClient,
      }}
      people
    />
  );
}
