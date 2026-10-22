import { Button } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ChevronLeft, ChevronRight } from "./icons";
import type { ComponentProps } from "react";

const arrowClass = "size-6 rounded-[var(--radius-small)] text-[var(--foreground-subtle)] [&_svg]:size-3.5";

/** Переключатель веток «‹ 2/3 ›»: на краю или пока идёт ответ стрелка неактивна. */
export function OduvanchikBranchSwitcher({ position, count, onPrevious, onNext }: ComponentProps<ChatSkin["BranchSwitcher"]>) {
  const labels = useChatLabels();
  return (
    <div role="group" aria-label={labels.branchPosition(position, count)} className="flex items-center">
      <Button variant="ghost" size="icon" aria-label={labels.previousBranch} disabled={!onPrevious} onClick={onPrevious} className={arrowClass}>
        <ChevronLeft />
      </Button>
      <span aria-hidden="true" className="min-w-[3ch] text-center text-xs tabular-nums text-[var(--foreground-muted)]">
        {position}/{count}
      </span>
      <Button variant="ghost" size="icon" aria-label={labels.nextBranch} disabled={!onNext} onClick={onNext} className={arrowClass}>
        <ChevronRight />
      </Button>
    </div>
  );
}
