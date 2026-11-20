import { Badge, Button, cn } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import type { ComponentProps } from "react";

/**
 * Одинаковые законченные шаги подряд одной строкой «Посмотрел работу ×4» (договор 37). Строка оформлена как строка
 * шага (`TandemToolCallRow`, `data-tool-state`), по нажатию под ней раскрываются сами шаги.
 */
export function TandemToolCallGroup({ toolName, title, count, open, onOpenChange, children }: ComponentProps<NonNullable<ChatSkin["ToolCallGroup"]>>) {
  const labels = useChatLabels();
  const detailsId = useId();
  const phrase = labels.toolDone(title?.trim() || toolName);
  return (
    <div data-tool-state="done" data-tool-group="" className="my-2 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] text-xs">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        aria-label={labels.toolRepeatedSpoken(phrase, count)}
        onClick={() => onOpenChange(!open)}
        className="h-auto min-h-9 w-full justify-start gap-2 rounded-[var(--radius-nested)] px-3 py-1.5 text-xs font-normal"
      >
        <Badge variant="success" className="shrink-0 py-0.5 font-medium">
          <Check aria-hidden="true" className="size-3" />
          {labels.workView.stepRepeated(phrase, count)}
        </Badge>
        <ChevronDown
          aria-hidden="true"
          className={cn("ml-auto size-3.5 shrink-0 text-[var(--foreground-subtle)] transition-transform duration-[var(--motion-fast)]", open && "rotate-180")}
        />
      </Button>
      {open && (
        <div id={detailsId} className="border-t border-[var(--border)] px-2">
          {children}
        </div>
      )}
    </div>
  );
}
