import { Button } from "@tandem/ui";
import type { MemorySkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Undo2 } from "lucide-react";
import type { ComponentProps } from "react";

type MemoryMergeProps = ComponentProps<MemorySkin["MemoryMerge"]>;

/**
 * Одно слияние в блоке «Объединено»: время, для каждой склейки «было» (список) и «стало», кнопка «Вернуть как было».
 * Кнопки нет, если вернуть уже нельзя. Всё переносится по словам: на телефоне нет горизонтальной прокрутки.
 */
export function TandemMemoryMerge({ finishedAt, groups, revertible, onRevert }: MemoryMergeProps) {
  const labels = useChatLabels();
  const when = labels.memoryMergeDate(new Date(finishedAt));
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="break-words text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">{when}</p>
      {groups.map((group) => (
        <div key={group.after} role="group" className="flex min-w-0 flex-col gap-2 text-sm leading-6">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-semibold text-[var(--foreground-muted)]">{labels.memoryMergeBefore}</p>
            <ul className="flex min-w-0 list-disc flex-col gap-1 pl-5 text-[var(--foreground-muted)]">
              {group.before.map((text, index) => (
                <li key={`${index}-${text}`} className="break-words">
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-semibold text-[var(--foreground-muted)]">{labels.memoryMergeAfter}</p>
            <p className="break-words text-[var(--foreground)]">{group.after}</p>
          </div>
        </div>
      ))}
      {revertible ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" aria-label={labels.memoryMergeRevertFor(when)} disabled={!onRevert} onClick={onRevert}>
            <Undo2 aria-hidden="true" />
            {labels.memoryMergeRevert}
          </Button>
        </div>
      ) : (
        <p className="break-words text-sm text-[var(--foreground-muted)]">{labels.memoryMergeNotRevertible}</p>
      )}
    </article>
  );
}
