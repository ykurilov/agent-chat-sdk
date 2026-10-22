import { Sphere } from "@ykurilov/ds-react";
import { Badge, Button, cn } from "@tandem/ui";
import type { ChatSkin, HelperCallStatus } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Check, ChevronDown, Users, X } from "./icons";
import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";
import { OduvanchikToolApprovalCard } from "./tool-approval-card";

type HelperCallRowProps = ComponentProps<NonNullable<ChatSkin["HelperCallRow"]>>;

const badgeVariant: Record<HelperCallStatus, "neutral" | "success" | "warm" | "cool"> = {
  running: "neutral",
  awaiting_approval: "cool",
  done: "success",
  failed: "warm",
  background: "cool",
};

/**
 * Поручение помощнику спокойной строкой: имя, статус и задание. По нажатию — что поручено,
 * шаги помощника и что он вернул. Подтверждение внутри помощника — та же карточка, что у инструмента:
 * что помощник хочет сделать и с какими данными; старый сервер без действия — имя помощника.
 */
export function OduvanchikHelperCallRow({ name, title, task, steps, text, status, approval, approvalAction, errorText, open, onOpenChange }: HelperCallRowProps) {
  const labels = useChatLabels();
  const detailsId = useId();
  const shownName = title ?? name;
  const decisionMark = approval && approval.state !== "requested" ? decisionLabel(approval.state, labels) : "";

  return (
    <div data-helper-status={status} className="my-2 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] text-xs">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => onOpenChange(!open)}
        className="h-auto min-h-9 w-full justify-start gap-2 rounded-[var(--radius-nested)] px-3 py-1.5 text-xs font-normal"
      >
        <Users aria-hidden="true" className="size-3.5 shrink-0 text-[var(--foreground-subtle)]" />
        <span className="min-w-0 truncate font-medium text-[var(--foreground)]">{shownName}</span>
        <Badge variant={badgeVariant[status]} className="shrink-0 gap-1 py-0.5 font-medium">
          <StatusMark status={status} />
          {labels.helpers.status[status]}
        </Badge>
        {decisionMark && <span className="shrink-0 text-[var(--foreground-muted)]">{decisionMark}</span>}
        {task && <span className="min-w-0 truncate text-[var(--foreground-muted)] max-sm:hidden">{task}</span>}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "ml-auto size-3.5 shrink-0 text-[var(--foreground-subtle)] transition-transform duration-[var(--motion-fast)]",
            open && "rotate-180",
          )}
        />
      </Button>
      {open && (
        <div id={detailsId} className="space-y-2.5 border-t border-[var(--border)] px-3 py-2.5">
          <Section heading={labels.helpers.assigned}>
            <p className="whitespace-pre-wrap break-words text-[var(--foreground)]">{task}</p>
          </Section>
          {steps.length > 0 && (
            <ol className="space-y-1">
              {steps.map((step) =>
                step.kind === "text" ? (
                  <li key={step.id} className="whitespace-pre-wrap break-words text-[var(--foreground-muted)]">
                    {step.text}
                  </li>
                ) : (
                  <li key={step.id} data-step-state={step.state} className="flex min-w-0 items-start gap-1.5">
                    <StepMark state={step.state} />
                    <span className="shrink-0 font-mono text-[var(--foreground)]">{step.title ?? step.toolName}</span>
                    {step.errorText && <span className="min-w-0 break-words text-[var(--destructive-text)]">{step.errorText}</span>}
                  </li>
                ),
              )}
            </ol>
          )}
          {text && (
            <Section heading={labels.helpers.returned}>
              <p className="whitespace-pre-wrap break-words text-[var(--foreground)]">{text}</p>
            </Section>
          )}
          {errorText && <p className="whitespace-pre-wrap break-words text-[var(--destructive-text)]">{errorText}</p>}
        </div>
      )}
      {approval?.state === "requested" && (
        <div className="px-3 pb-1">
          {approvalAction ? (
            <OduvanchikToolApprovalCard toolName={approvalAction.toolName} title={approvalAction.title} input={approvalAction.input} approval={approval} />
          ) : (
            <OduvanchikToolApprovalCard toolName={name} title={shownName} input={undefined} approval={approval} />
          )}
        </div>
      )}
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[var(--foreground-subtle)]">{heading}</p>
      {children}
    </div>
  );
}

function decisionLabel(state: "allowed" | "always" | "denied", labels: ReturnType<typeof useChatLabels>): string {
  if (state === "allowed") return labels.approvalAllowedMark;
  return state === "always" ? labels.approvalAlwaysMark : labels.approvalDeniedMark;
}

/** Работа без крутящегося значка: Тандем показывает занятость спокойной пульсацией. */
function StatusMark({ status }: { status: HelperCallStatus }) {
  if (status === "done") return <Check aria-hidden="true" className="size-3" />;
  if (status === "failed") return <X aria-hidden="true" className="size-3" />;
  return <Sphere size={16} />;
}

function StepMark({ state }: { state: "running" | "done" | "error" }) {
  if (state === "done") return <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-[var(--success-text)]" />;
  if (state === "error") return <X aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-[var(--destructive-text)]" />;
  return <Sphere size={16} />;
}
