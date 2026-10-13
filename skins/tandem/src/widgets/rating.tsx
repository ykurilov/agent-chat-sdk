import type { WidgetView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Star } from "lucide-react";
import { useId } from "react";
import { RadioOptions } from "./radio-options";
import { WidgetFrame } from "./widget-frame";

/** Оценка: звёзды 1–5 или шкала с подписями краёв. Одно нажатие отвечает; на узком экране деления переносятся. */
export function TandemRatingWidget(view: Extract<WidgetView, { kind: "rating" }>) {
  const labels = useChatLabels();
  const questionId = useId();
  const onPick = view.onRate && !view.pending ? view.onRate : undefined;
  const values = Array.from({ length: view.to - view.from + 1 }, (_, index) => view.from + index);
  const stars = view.scale === "stars";
  return (
    <WidgetFrame
      headingId={questionId}
      heading={view.question}
      answeredByMessage={view.answeredByMessage}
      {...(view.active && { hint: labels.widgets.choose })}
      {...(view.failure && { failure: view.failure })}
    >
      <RadioOptions
        labelledBy={questionId}
        layout="inline"
        options={values.map((value) => ({
          value,
          ariaLabel: labels.widgets.ratingStars(value, view.to),
          checked: view.value === value,
          content: stars ? (
            <Star aria-hidden="true" className="size-5" fill={view.value !== undefined && value <= view.value ? "currentColor" : "none"} />
          ) : (
            <span className="w-full text-center tabular-nums">{value}</span>
          ),
        }))}
        optionClassName={() => "justify-center px-2"}
        {...(onPick && { onPick })}
      />
      {!stars && (view.fromLabel || view.toLabel) && (
        <div className="flex justify-between gap-3 text-xs text-[var(--foreground-muted)]">
          <span className="break-words">{view.fromLabel}</span>
          <span className="break-words text-right">{view.toLabel}</span>
        </div>
      )}
    </WidgetFrame>
  );
}
