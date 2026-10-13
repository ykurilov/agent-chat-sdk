import { Button, cn } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { ComponentProps } from "react";
import { TandemThinkingLabel } from "./thinking-label";

/** Рассуждения модели: пока идут — живая надпись с временем, потом тихая строка «Думал N сек»; текст — по нажатию. */
export function TandemReasoning({ text, streaming, durationMs, open, onOpenChange }: ComponentProps<ChatSkin["Reasoning"]>) {
  const labels = useChatLabels();
  const contentId = useId();
  const title = streaming ? (
    <TandemThinkingLabel />
  ) : durationMs === null ? (
    labels.reasoningRunning
  ) : (
    labels.reasoningDone(Math.max(1, Math.round(durationMs / 1000)))
  );

  return (
    <div className="mb-2 not-first:mt-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => onOpenChange(!open)}
        className="-ml-2 h-7 gap-1 px-2 text-xs font-medium text-[var(--foreground-muted)]"
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 transition-transform duration-[var(--motion-fast)]", open && "rotate-180")}
        />
      </Button>
      {open && (
        <div
          id={contentId}
          className="mt-1 whitespace-pre-wrap border-l-2 border-[var(--border)] pl-3 text-xs leading-5 text-[var(--foreground-muted)]"
        >
          {text}
        </div>
      )}
    </div>
  );
}
