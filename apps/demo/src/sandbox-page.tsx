import { attachmentsClient } from "@ykurilov/agent-chat-attachments/react";
import { diagramsClient } from "@ykurilov/agent-chat-diagrams";
import { AgentSandbox } from "@ykurilov/agent-chat-skin-oduvanchik/sandbox";
import { OduvanchikChatNotFound } from "@ykurilov/agent-chat-skin-oduvanchik";
import { TandemChatNotFound, tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
import { tandemSandboxSkin } from "@ykurilov/agent-chat-skin-tandem/sandbox";
import { videosClient } from "@ykurilov/agent-chat-videos/react";
import { useEffect, useState } from "react";
import { demoImageClients, demoWidgets } from "./chat-features";

const sandboxApi = "/api/sandbox";
const explicitTandem = new URLSearchParams(location.search).get("skin") === "tandem";

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
    return explicitTandem ? <TandemChatNotFound /> : <OduvanchikChatNotFound />;
  }
  return (
    <AgentSandbox
      basePath={sandboxApi}
      {...(explicitTandem && { skin: tandemSkin, sandboxSkin: tandemSandboxSkin, chatListSkin: tandemSkin })}
      chatProps={{
        composerOptions: { variant: "extended" },
        attachments: attachmentsClient,
        widgets: demoWidgets,
        diagrams: diagramsClient,
        images: demoImageClients,
        videos: videosClient,
      }}
      people
    />
  );
}
