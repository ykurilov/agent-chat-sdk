import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Scissors } from "lucide-react";

/** Отметка у ответа, озвучку которого оборвали: «Вы перебили: озвучено до «…»». Если не озвучено ни слова, отмечать нечего. */
export function TandemInterruptMark({ spokenTail }: { spokenTail: string }) {
  const words = useChatLabels().voiceDialog;
  if (spokenTail.trim() === "") return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 break-words text-xs text-[var(--foreground-muted)]">
      <Scissors aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{words.interruptedMark(spokenTail)}</span>
    </p>
  );
}
