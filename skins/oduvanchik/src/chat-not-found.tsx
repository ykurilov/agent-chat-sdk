import { useChatLabels } from "@ykurilov/agent-chat-react";
import { MessageSquareOff } from "./icons";

/** Чат чужой или его нет: спокойная надпись по центру, без ленты и поля ввода. */
export function OduvanchikChatNotFound() {
  const labels = useChatLabels();
  return (
    <main className="grid h-full place-items-center bg-[var(--canvas)] p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <MessageSquareOff aria-hidden="true" className="size-8 text-[var(--foreground-muted)]" />
        <h1 className="text-lg font-semibold text-[var(--foreground)]">{labels.chatNotFound}</h1>
      </div>
    </main>
  );
}
