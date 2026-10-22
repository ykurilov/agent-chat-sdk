import { Button } from "@tandem/ui";
import { Alert } from "./primitives/alert";
import type { MemorySkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Brain, Plus, Trash2 } from "./icons";
import { useId } from "react";
import type { ComponentProps } from "react";
import { OduvanchikSkinLabels } from "./tandem-labels";

type MemoryScreenProps = ComponentProps<MemorySkin["MemoryScreen"]>;

/**
 * Экран памяти: заголовок со счётчиком, кнопки «Добавить» и «Стереть всю память», подсказка «показано агенту N из M»,
 * надписи состояний, блок «Объединено» под списком. Всё переносится по строкам: на телефоне нет горизонтальной прокрутки.
 */
export function OduvanchikMemoryScreen({ status, counts, onAdd, onClearAll, onRetry, error, newNoteEditor, merges, confirm, children }: MemoryScreenProps) {
  const labels = useChatLabels();
  const headingId = useId();
  const mergesHeadingId = useId();
  const hiddenFromAgent = counts !== undefined && counts.shown < counts.total;

  return (
    <OduvanchikSkinLabels>
      <section aria-labelledby={headingId} className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4 px-4 py-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={headingId} className="text-lg font-semibold text-[var(--foreground)]">
              {labels.memoryHeading}
            </h2>
            {counts && <p className="text-sm text-[var(--foreground-muted)]">{labels.memoryCount(counts.total, counts.limit)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {onAdd && (
              <Button variant="primary" size="md" onClick={onAdd}>
                <Plus aria-hidden="true" />
                {labels.memoryAdd}
              </Button>
            )}
            {onClearAll && (
              <Button variant="secondary" size="md" onClick={onClearAll}>
                <Trash2 aria-hidden="true" />
                {labels.memoryClearAll}
              </Button>
            )}
          </div>
        </header>
        {hiddenFromAgent && <p className="break-words text-sm text-[var(--foreground-muted)]">{labels.memoryShownHint(counts.shown, counts.total)}</p>}
        {error && (
          <p role="alert" className="break-words text-sm text-[var(--destructive-text)]">
            {error}
          </p>
        )}
        {newNoteEditor}
        {status === "loading" && <p className="text-sm text-[var(--foreground-muted)]">{labels.memoryLoading}</p>}
        {status === "error" && (
          <Alert
            variant="warm"
            title={labels.memoryLoadFailed}
            className="w-full"
            {...(onRetry && {
              action: (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  {labels.retry}
                </Button>
              ),
            })}
          />
        )}
        {(status === "empty" || status === "unavailable") && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Brain aria-hidden="true" className="size-8 text-[var(--foreground-muted)]" />
            <p className="max-w-prose break-words text-sm text-[var(--foreground-muted)]">
              {status === "empty" ? labels.memoryEmpty : labels.memoryUnavailable}
            </p>
          </div>
        )}
        {status === "ready" && <div className="flex min-w-0 flex-col gap-5">{children}</div>}
        {status === "ready" && merges && (
          <section aria-labelledby={mergesHeadingId} className="flex min-w-0 flex-col gap-3">
            <h3 id={mergesHeadingId} className="text-sm font-semibold text-[var(--foreground)]">
              {labels.memoryMergesHeading}
            </h3>
            {merges}
          </section>
        )}
        {confirm}
      </section>
    </OduvanchikSkinLabels>
  );
}
