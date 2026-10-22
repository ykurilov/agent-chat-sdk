import type { AgentNoticeViewKind, ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Info } from "./icons";
import type { ComponentProps } from "react";
import { OduvanchikToolApprovalCard } from "./tool-approval-card";

type AgentNoticeProps = ComponentProps<NonNullable<ChatSkin["AgentNoticeView"]>>;
type Labels = ReturnType<typeof useChatLabels>;

/**
 * Служебное сообщение в ленте — спокойная плашка, а не пузырь человека: что случилось, с какой задачей, итог или ошибка.
 * Итог и ошибка — только текстом. Задача ждёт решения — та же карточка подтверждения, что у инструмента.
 */
export function OduvanchikAgentNotice({ kind, title, result, errorText, approval }: AgentNoticeProps) {
  const labels = useChatLabels();
  const decisionMark = approval && approval.state !== "requested" ? (approval.state === "denied" ? labels.approvalDeniedMark : approval.state === "always" ? labels.approvalAlwaysMark : labels.approvalAllowedMark) : "";
  return (
    <div role="note" data-notice-kind={kind} className="my-3 rounded-[var(--radius-nested)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Info aria-hidden="true" className="size-3.5 shrink-0 text-[var(--foreground-subtle)]" />
        <span className="text-[var(--foreground-muted)]">{capitalized(kindLabel(kind, labels))}</span>
        {title && <span className="min-w-0 break-words font-medium text-[var(--foreground)]">{title}</span>}
        {decisionMark && <span className="text-[var(--foreground-muted)]">· {decisionMark}</span>}
      </p>
      {result && <p className="mt-1.5 whitespace-pre-wrap break-words text-[var(--foreground)]">{result}</p>}
      {errorText && <p className="mt-1.5 whitespace-pre-wrap break-words text-[var(--destructive-text)]">{errorText}</p>}
      {approval?.state === "requested" && <OduvanchikToolApprovalCard toolName={title} title={title} input={undefined} approval={approval} />}
    </div>
  );
}

function kindLabel(kind: AgentNoticeViewKind, labels: Labels): string {
  const notices = labels.notices;
  switch (kind) {
    case "task_done":
      return notices.taskDone;
    case "task_failed":
      return notices.taskFailed;
    case "task_canceled":
      return notices.taskCanceled;
    case "task_interrupted":
      return notices.taskInterrupted;
    case "task_timed_out":
      return notices.taskTimedOut;
    case "task_awaiting_approval":
      return notices.taskAwaitingApproval;
    case "conversation_started":
      return notices.conversationStarted;
  }
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
