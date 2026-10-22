import { Sphere } from "@ykurilov/ds-react";
import { Badge, Button } from "@tandem/ui";
import type { ChatSkin, TaskStatusView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Check, Clock, X } from "./icons";
import { useId } from "react";
import type { ComponentProps } from "react";

type TaskCardProps = ComponentProps<NonNullable<ChatSkin["TaskCard"]>>;

const badgeVariant: Record<TaskStatusView, "neutral" | "success" | "warm" | "cool"> = {
  queued: "neutral",
  running: "neutral",
  awaiting_approval: "cool",
  done: "success",
  failed: "warm",
  canceled: "neutral",
  interrupted: "warm",
  timed_out: "warm",
};

/** Фоновая задача над полем ввода: название, статус, сколько идёт и «Отменить». Занятость — спокойная пульсация. */
export function OduvanchikTaskCard({ id, title, status, elapsedMs, onCancel, canceling }: TaskCardProps) {
  const labels = useChatLabels();
  const titleId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-task-id={id}
      data-task-status={status}
      className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs"
    >
      <Clock aria-hidden="true" className="size-3.5 shrink-0 text-[var(--foreground-subtle)]" />
      <span id={titleId} className="min-w-0 flex-1 basis-32 truncate font-medium text-[var(--foreground)]">
        {title}
      </span>
      <Badge variant={badgeVariant[status]} className="shrink-0 gap-1 py-0.5 font-medium">
        <StatusMark status={status} />
        {labels.tasks.status[status]}
      </Badge>
      <span className="shrink-0 tabular-nums text-[var(--foreground-muted)]">{labels.tasks.elapsed(elapsedMs, status !== "queued" && status !== "running" && status !== "awaiting_approval")}</span>
      {onCancel && (
        <Button size="sm" variant="ghost" className="ml-auto shrink-0" disabled={canceling} onClick={onCancel}>
          {canceling ? labels.tasks.canceling : labels.tasks.cancel}
        </Button>
      )}
    </div>
  );
}

function StatusMark({ status }: { status: TaskStatusView }) {
  if (status === "done") return <Check aria-hidden="true" className="size-3" />;
  if (status === "failed" || status === "canceled" || status === "interrupted" || status === "timed_out") return <X aria-hidden="true" className="size-3" />;
  return <Sphere size={16} />;
}
