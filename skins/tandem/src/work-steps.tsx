import { Button, cn } from "@tandem/ui";
import type { WorkStepsView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ChevronDown } from "lucide-react";
import { useId } from "react";

/**
 * Простой вид работы агента (договор 23). Пока ход идёт — тихая живая строка с текущим шагом, смена фразы плавная.
 * Диктор слышит одно постоянное «Работаю…»: фразы меняются часто и от него скрыты.
 * После хода — строка «Сделано N шагов» в стиле «Думал N сек»; по нажатию — список понятных фраз, неудачный шаг тусклее.
 */
export function TandemWorkSteps(view: WorkStepsView) {
  const labels = useChatLabels();
  const listId = useId();
  if (view.state === "live") {
    return (
      <div data-work-live className="mb-2 flex h-7 min-w-0 items-center gap-2 last:mb-0 text-xs font-medium text-[var(--foreground-muted)] not-first:mt-3">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--action)] motion-safe:animate-pulse" />
        <span key={view.phrase} aria-hidden="true" data-work-phrase className="min-w-0 truncate motion-safe:animate-[tandem-fade-in_var(--motion-fast)_ease-out]">
          {view.phrase}
        </span>
        <span role="status" className="sr-only">
          {labels.workView.live(labels.workView.stepRunning)}
        </span>
      </div>
    );
  }
  const { steps, count, open, onOpenChange } = view;
  return (
    <div className="mb-2 not-first:mt-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => onOpenChange(!open)}
        className="-ml-2 h-7 gap-1 px-2 text-xs font-medium text-[var(--foreground-muted)]"
      >
        {labels.workView.stepsDone(count)}
        <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform duration-[var(--motion-fast)]", open && "rotate-180")} />
      </Button>
      <ol id={listId} hidden={!open} className="mt-1 space-y-1 border-l-2 border-[var(--border)] pl-3 text-xs leading-5 text-[var(--foreground-muted)]">
        {open &&
          steps.map((step, index) => (
            <li key={index} data-work-step data-failed={String(step.failed)} className={cn("min-w-0 break-words [overflow-wrap:anywhere]", step.failed && "text-[var(--foreground-subtle)] line-through decoration-[var(--border)]")}>
              {step.phrase}
            </li>
          ))}
      </ol>
    </div>
  );
}
