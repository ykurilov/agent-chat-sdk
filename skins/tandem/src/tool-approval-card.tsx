import { Button } from "@tandem/ui";
import type { ChatSkin, ToolApprovalView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ShieldQuestion } from "lucide-react";
import { useId, useRef } from "react";
import type { ComponentProps } from "react";

type ToolCallRowProps = ComponentProps<ChatSkin["ToolCallRow"]>;
type RequestedApproval = Extract<ToolApprovalView, { state: "requested" }>;
type Decision = Parameters<RequestedApproval["onDecide"]>[0];

/**
 * Карточка вместо строки вызова, пока действие ждёт решения: что агент хочет сделать,
 * с какими данными, и кнопки. Пока ответ уходит на сервер, кнопки заняты.
 * Для чтения с экрана это группа с названием действия. Нажатая кнопка блокируется,
 * поэтому фокус переходит на саму карточку, чтобы не пропасть.
 * «Ждёт вашего решения» лежит в области aria-live, которая есть на странице заранее:
 * текст, появившийся вместе с областью, читалка не озвучивает.
 * На телефоне названия полей стоят над значениями, длинный вход прокручивается внутри карточки.
 */
export function TandemToolApprovalCard({
  toolName,
  title,
  input,
  approval,
}: Pick<ToolCallRowProps, "toolName" | "title" | "input"> & { approval: RequestedApproval }) {
  const labels = useChatLabels();
  const headingId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const entries = inputEntries(input);
  const decide = (decision: Decision) => {
    cardRef.current?.focus();
    approval.onDecide(decision);
  };

  return (
    <div
      ref={cardRef}
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-tool-state="awaiting-approval"
      className="my-2 space-y-3 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <p id={headingId} className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
        <ShieldQuestion aria-hidden="true" className="size-4 shrink-0 text-[var(--foreground-subtle)]" />
        {labels.approvalRequested(title ?? toolName)}
      </p>
      {entries.length > 0 && (
        <div data-approval-input tabIndex={0} className="max-h-60 overflow-y-auto">
          <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,max-content)_minmax(0,1fr)]">
            {entries.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="min-w-0 break-words text-[var(--foreground-muted)]">{name}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-[var(--foreground)]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={approval.pending} onClick={() => decide("allow")}>
          {labels.approvalAllow}
        </Button>
        <Button size="sm" variant="secondary" disabled={approval.pending} onClick={() => decide("deny")}>
          {labels.approvalDeny}
        </Button>
        {approval.canAlways && (
          <Button size="sm" variant="ghost" disabled={approval.pending} onClick={() => decide("always")}>
            {labels.approvalAlways}
          </Button>
        )}
      </div>
      <p data-approval-waiting aria-live="polite" className="text-[var(--foreground-muted)] empty:hidden">
        {approval.pending ? labels.approvalWaiting : ""}
      </p>
      {approval.failed && (
        <p role="alert" className="text-[var(--destructive-text)]">
          {approval.failureText ?? labels.approvalFailed}
        </p>
      )}
    </div>
  );
}

/** Входные данные строками «поле — значение»: простое как есть, вложенное — читаемым JSON. */
function inputEntries(input: unknown): [string, string][] {
  if (input === undefined || input === null) return [];
  if (typeof input !== "object" || Array.isArray(input)) return [["", String(JSON.stringify(input, null, 2))]];
  return Object.entries(input).map(([name, value]) => [
    name,
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? ""),
  ]);
}
