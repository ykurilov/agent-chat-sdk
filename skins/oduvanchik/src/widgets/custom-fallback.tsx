import type { WidgetView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useId } from "react";
import { WidgetFrame } from "./widget-frame";

/** Свой виджет страницы: её компонент внутри рамки; компонента нет — вопрос и «Ответьте сообщением» (FR-018). */
export function OduvanchikCustomWidget(view: Extract<WidgetView, { kind: "custom" }>) {
  const labels = useChatLabels();
  const questionId = useId();
  return (
    <WidgetFrame
      headingId={questionId}
      {...(view.content === undefined && view.question && { heading: view.question })}
      answeredByMessage={view.answeredByMessage}
      {...(view.failure && { failure: view.failure })}
    >
      {view.content ?? <p className="text-xs text-[var(--foreground-muted)]">{labels.widgets.fallback}</p>}
    </WidgetFrame>
  );
}
