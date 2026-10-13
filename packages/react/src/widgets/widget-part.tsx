import { memo, useCallback, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useChatLabels } from "../labels";
import { CustomWidgetGuard } from "./custom-widget-guard";
import type { CustomWidgetProps, WidgetView } from "../skin-contract";
import { formCheckMessages } from "./form-check";
import { widgetViewOf } from "./widget-view";
import type { WidgetCall } from "./widget-view";

/**
 * Виджет в ленте: вид для скина и свой компонент страницы внутри него. Ошибки полей формы живут здесь, пока человек
 * не отправит форму верно. Упавший свой компонент заменяется запасным видом скина.
 */
export const WidgetPart = memo(function WidgetPart({
  Widget,
  Custom,
  call,
  chatId,
  pending,
  failure,
  onAnswer,
}: {
  Widget: ComponentType<WidgetView>;
  /** Компонент своего виджета из `widgets[name]`; нет — запасной вид скина. */
  Custom?: ComponentType<CustomWidgetProps<unknown, unknown>>;
  call: WidgetCall;
  chatId: string;
  pending: boolean;
  failure?: string;
  onAnswer: (toolCallId: string, answer: unknown) => void;
}) {
  const labels = useChatLabels();
  const messages = useMemo(() => formCheckMessages(labels.widgets), [labels.widgets]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const toolCallId = call.toolCallId;
  const answer = useCallback((value: unknown) => onAnswer(toolCallId, value), [onAnswer, toolCallId]);
  const [crashed, setCrashed] = useState(false);
  const onCrash = useCallback(() => setCrashed(true), []);
  const active = call.state === "pending";
  const content = Custom && !crashed && (
    <CustomWidgetGuard onCrash={onCrash}>
      <Custom
        input={call.input}
        chatId={chatId}
        toolCallId={toolCallId}
        state={call.state}
        pending={pending}
        {...(call.answer !== undefined && { answer: call.answer })}
        {...(active && { onAnswer: answer })}
        {...(failure !== undefined && { failure })}
      />
    </CustomWidgetGuard>
  );
  const view = widgetViewOf(call, {
    pending,
    ...(failure !== undefined && { failure }),
    ...(active && { onAnswer: answer }),
    fieldErrors,
    onInvalid: setFieldErrors,
    messages,
    ...(content && { content }),
  });
  return view ? <Widget {...view} /> : null;
});
