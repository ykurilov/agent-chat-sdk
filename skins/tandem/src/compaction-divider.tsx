import { Button, cn } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { ComponentProps } from "react";
import { SafeMarkdown } from "./safe-markdown";

/** Граница сжатой истории: тихая строка «История сжата» между линиями, сводка — по нажатию; скрыта правами — без кнопки. */
export function TandemCompactionDivider({ summary, open, onOpenChange }: ComponentProps<ChatSkin["CompactionDivider"]>) {
  const labels = useChatLabels();
  const contentId = useId();
  return (
    <div className="my-3" data-compaction-divider="">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
        {summary === "" ? (
          <span className="px-2 text-xs font-medium text-[var(--foreground-muted)]">{labels.historyCompacted}</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => onOpenChange(!open)}
            className="h-7 gap-1 px-2 text-xs font-medium text-[var(--foreground-muted)]"
          >
            {labels.historyCompacted}
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3.5 transition-transform duration-[var(--motion-fast)]", open && "rotate-180")}
            />
          </Button>
        )}
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
      </div>
      {open && summary !== "" && (
        <div id={contentId} className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground-muted)]">
          <p className="mb-2 text-xs">{labels.historyCompactedHint}</p>
          <SafeMarkdown markdown={summary} />
        </div>
      )}
    </div>
  );
}
