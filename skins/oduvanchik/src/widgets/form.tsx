import { Button, cn } from "@tandem/ui";
import type { FormFieldView, WidgetView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useId, useState } from "react";
import type { FocusEvent } from "react";
import { TOUCH_TARGET, WidgetFrame } from "./widget-frame";

type Values = Record<string, string>;

/**
 * Форма: поля по видам (числа с цифровой клавиатурой, дата, список, текст), пометка обязательных, ошибки у полей.
 * Проверяет и отправляет слой поведения: здесь только ввод. Поле в фокусе прокручивается в середину видимой части —
 * экранная клавиатура телефона его не закрывает (FR-020).
 */
export function OduvanchikFormWidget(view: Extract<WidgetView, { kind: "form" }>) {
  const labels = useChatLabels();
  const titleId = useId();
  const fieldIdBase = useId();
  const [values, setValues] = useState<Values>(() => Object.fromEntries(Object.entries(view.values ?? {}).map(([name, value]) => [name, String(value)])));
  const answering = Boolean(view.onSubmit);
  const shown: Values = answering ? values : Object.fromEntries(Object.entries(view.values ?? {}).map(([name, value]) => [name, String(value)]));
  return (
    <WidgetFrame
      headingId={titleId}
      heading={view.title}
      answeredByMessage={view.answeredByMessage}
      {...(view.failure && { failure: view.failure })}
    >
      <form
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!view.pending) view.onSubmit?.(values);
        }}
      >
        {view.fields.map((field) => (
          <FormField
            key={field.name}
            id={`${fieldIdBase}-${field.name}`}
            field={field}
            value={shown[field.name] ?? ""}
            disabled={!answering || view.pending}
            requiredMark={labels.widgets.formRequired}
            onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
          />
        ))}
        {answering && (
          <Button type="submit" size="sm" style={TOUCH_TARGET} disabled={view.pending}>
            {labels.widgets.formSubmit}
          </Button>
        )}
      </form>
    </WidgetFrame>
  );
}

const CONTROL =
  "tandem-focus w-full min-w-0 rounded-[var(--radius-control)] border bg-[var(--surface-raised)] px-3 py-2 text-base text-[var(--foreground)] disabled:opacity-70 sm:text-sm";

function FormField({
  id,
  field,
  value,
  disabled,
  requiredMark,
  onChange,
}: {
  id: string;
  field: FormFieldView;
  value: string;
  disabled: boolean;
  requiredMark: string;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  const common = {
    id,
    value,
    disabled,
    required: field.required,
    style: TOUCH_TARGET,
    "aria-invalid": field.error ? true : undefined,
    "aria-describedby": field.error ? errorId : undefined,
    onFocus: keepVisible,
    className: cn(CONTROL, field.error ? "border-[var(--destructive-text)]" : "border-[var(--border)]"),
  };
  const edge = (key: "min" | "max") => (field[key] === undefined ? {} : { [key]: String(field[key]) });
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-[var(--foreground-muted)]">
        <span className="break-words">{field.label}</span>
        {field.required && (
          <span aria-hidden="true" title={requiredMark} className="ml-0.5 text-[var(--destructive-text)]">
            *
          </span>
        )}
      </label>
      {field.kind === "select" ? (
        <select {...common} onChange={(event) => onChange(event.target.value)}>
          <option value="" />
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.kind === "text" && field.multiline ? (
        <textarea {...common} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          type={field.kind === "date" ? "date" : "text"}
          {...(field.kind === "number" && { inputMode: "numeric" as const })}
          {...(field.kind === "date" && { ...edge("min"), ...edge("max") })}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.error && (
        <p id={errorId} className="text-xs text-[var(--destructive-text)]">
          {field.error}
        </p>
      )}
    </div>
  );
}

function keepVisible(event: FocusEvent<HTMLElement>) {
  event.currentTarget.scrollIntoView?.({ block: "center", behavior: "smooth" });
}
