"use client";

import { attachmentsClient } from "@ykurilov/agent-chat-attachments/react";
import { AgentChat } from "@ykurilov/agent-chat-react";
import { useEffect, useState } from "react";
import { userCookieName } from "@/lib/user-cookie";
import { plainSkin } from "./plain-skin";

/** This hook must run during SSR as well as hydration, to catch accidentally externalized React. */
function AttachmentSsrProbe() {
  const controller=attachmentsClient.useController({api:"/api/chat",chatId:"ssr-probe",modelSeesImages:false});
  return <output hidden data-attachment-ssr="ready">Attachment SSR ready: {controller.composer.items.length}</output>;
}

/** Открывает новый чат и показывает его. Имя пользователя пример кладёт в cookie сам; в приложении это делает ваш вход. */
export function ChatPage() {
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    if (!document.cookie.includes(`${userCookieName}=`)) document.cookie = `${userCookieName}=anna; path=/`;
    void fetch("/api/chat", { method: "POST" })
      .then((response) => response.json() as Promise<{ id: string }>)
      .then((chat) => setChatId(chat.id));
  }, []);

  return <><AttachmentSsrProbe />{!chatId ? <p style={{ padding: 16 }}>Открываем чат…</p> : <AgentChat api="/api/chat" chatId={chatId} skin={plainSkin} attachments={attachmentsClient} />}</>;
}
