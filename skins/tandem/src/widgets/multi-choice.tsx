import { Button, cn } from "@tandem/ui";
import type { WidgetView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useId, useState } from "react";
import { TOUCH_TARGET, WidgetFrame } from "./widget-frame";

/** Несколько вариантов: флажки и «Готово», которая активна, только когда выбрано от `min` до `max`. */
export function TandemMultiChoiceWidget(view: Extract<WidgetView, { kind: "multi_choice" }>) {
  const labels = useChatLabels();
  const questionId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(view.chosen ?? []));
  const answering = Boolean(view.onSubmit);
  const shown = answering ? picked : new Set(view.chosen ?? []);
  const fits = picked.size >= view.min && picked.size <= view.max;
  const toggle = (option: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(option)) next.add(option);
      return next;
    });
  return (
    <WidgetFrame
      headingId={questionId}
      heading={view.question}
      answeredByMessage={view.answeredByMessage}
      {...(view.active && { hint: labels.widgets.choose })}
      {...(view.failure && { failure: view.failure })}
    >
      {answering && <p className="text-xs text-[var(--foreground-muted)]">{labels.widgets.choiceRange(view.min, view.max)}</p>}
      <div className="flex flex-col gap-2" role="group" aria-labelledby={questionId}>
        {view.options.map((option) => (
          <label
            key={option}
            style={TOUCH_TARGET}
            className={cn(
              "flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2",
              answering ? "cursor-pointer" : "opacity-80",
            )}
          >
            <input
              type="checkbox"
              className="tandem-focus size-5 shrink-0 accent-[var(--action)]"
              checked={shown.has(option)}
              disabled={!answering || view.pending}
              onChange={() => toggle(option)}
            />
            <span className="min-w-0 whitespace-pre-wrap break-words">{option}</span>
          </label>
        ))}
      </div>
      {answering && (
        <Button
          size="sm"
          style={TOUCH_TARGET}
          disabled={!fits || view.pending}
          onClick={() => view.onSubmit?.(view.options.filter((option) => picked.has(option)))}
        >
          {labels.widgets.submit}
        </Button>
      )}
    </WidgetFrame>
  );
}
