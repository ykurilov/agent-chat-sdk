import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ReactNode } from "react";

/** Цель нажатия на телефоне — не меньше 44 пунктов (FR-020). */
export const TOUCH_TARGET = { minHeight: 44, minWidth: 44 } as const;

/**
 * Рамка виджета в ленте: подписанная группа, пометка «ответ дан сообщением», подсказка и причина сбоя словами.
 * Тексты модели здесь и во всех виджетах — только текстом: ни разметки, ни HTML (FR-009).
 * Виджет не берёт фокус сам: человек, который печатает ответ своими словами, остаётся в поле ввода (FR-021).
 */
export function WidgetFrame({
  headingId,
  heading,
  answeredByMessage,
  hint,
  failure,
  children,
}: {
  headingId: string;
  heading?: string;
  answeredByMessage: boolean;
  hint?: string;
  failure?: string;
  children: ReactNode;
}) {
  const labels = useChatLabels();
  return (
    <div
      role="group"
      aria-labelledby={heading ? headingId : undefined}
      data-widget
      className="my-2 min-w-0 space-y-3 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--foreground)]"
    >
      {heading && (
        <p id={headingId} className="whitespace-pre-wrap break-words font-medium">
          {heading}
        </p>
      )}
      {children}
      {hint && <p className="text-xs text-[var(--foreground-muted)]">{hint}</p>}
      {answeredByMessage && <p className="text-xs text-[var(--foreground-muted)]">{labels.widgets.answeredByMessage}</p>}
      {failure && (
        <p role="alert" className="text-xs text-[var(--destructive-text)]">
          {failure}
        </p>
      )}
    </div>
  );
}
