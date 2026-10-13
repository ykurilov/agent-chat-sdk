import type { WidgetView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useId } from "react";
import { RadioOptions } from "./radio-options";
import { WidgetFrame } from "./widget-frame";

/** Выбор одного варианта: одно нажатие отвечает (SC-001); варианты — строками, на узком экране не теснятся. */
export function TandemChoiceWidget(view: Extract<WidgetView, { kind: "choice" }>) {
  const labels = useChatLabels();
  const questionId = useId();
  const onPick = view.onChoose && !view.pending ? view.onChoose : undefined;
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
        layout="rows"
        options={view.options.map((option) => ({
          value: option,
          content: <span className="whitespace-pre-wrap break-words">{option}</span>,
          checked: view.chosen === option,
        }))}
        {...(onPick && { onPick })}
      />
    </WidgetFrame>
  );
}
