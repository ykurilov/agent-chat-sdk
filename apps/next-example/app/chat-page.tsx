"use client";

import { AgentChat } from "@ykurilov/agent-chat-react";
import { useEffect, useState } from "react";
import { userCookieName } from "@/lib/user-cookie";
import { plainSkin } from "./plain-skin";

/** Открывает новый чат и показывает его. Имя пользователя пример кладёт в cookie сам; в приложении это делает ваш вход. */
export function ChatPage() {
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    if (!document.cookie.includes(`${userCookieName}=`)) document.cookie = `${userCookieName}=anna; path=/`;
    void fetch("/api/chat", { method: "POST" })
      .then((response) => response.json() as Promise<{ id: string }>)
      .then((chat) => setChatId(chat.id));
  }, []);

  if (!chatId) return <p style={{ padding: 16 }}>Открываем чат…</p>;
  return <AgentChat api="/api/chat" chatId={chatId} skin={plainSkin} />;
}
