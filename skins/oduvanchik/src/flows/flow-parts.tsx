import { cn, Select, FieldLabel } from "./controls";
import { Button as DsButton, MonoLabel, ScrollArea, type IconComponent } from "@ykurilov/ds-react";
import type { FlowEdgeKind, FlowIssueCount } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { ClockIcon as Clock, DatabaseIcon as Database, ChatTextIcon as MessageSquareText, ArrowUUpLeftIcon as Undo2, LightningIcon as Zap, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { isValidElement, type ReactNode } from "react";

// Общие мелочи скина редактора: цвета и значки видов условий, подписи разделов, выпадающий список, счётчик ошибок.

/** Цвет вида стрелки: словами — действие, данные — приглушённый, событие — успех, таймер — тёплый пунктиром. */
export const KIND_COLOR: Record<FlowEdgeKind, string> = {
  judge: "var(--yk-accent)",
  data: "var(--yk-muted)",
  event: "var(--yk-success)",
  timer: "var(--yk-accent)",
  return: "var(--yk-muted)",
};

export const KIND_DASH: Record<FlowEdgeKind, string | undefined> = {
  judge: undefined,
  data: undefined,
  event: undefined,
  timer: "6 5",
  return: "2 4",
};

export const KIND_ICON: Record<FlowEdgeKind, PhosphorIcon> = {
  judge: MessageSquareText,
  data: Database,
  event: Zap,
  timer: Clock,
  return: Undo2,
};

export function KindIcon({ kind, className }: { kind: FlowEdgeKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", className)} style={{ color: KIND_COLOR[kind] }} />;
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-xs font-normal font-mono uppercase tracking-wide text-[var(--yk-muted)]", className)}>{children}</h3>;
}

export { Select };

/** Подпись над полем ввода. */
export function Labeled({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <FieldLabel.Provider value={label}><div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <MonoLabel>{label}</MonoLabel>
      {children}
      {hint && <span className="text-xs text-[var(--yk-muted)]">{hint}</span>}
    </div></FieldLabel.Provider>
  );
}

/** «Ошибок: 2 · Замечаний: 1» — красным и тёплым; ничего — ничего. */
export function IssueBadge({ issues, className }: { issues: FlowIssueCount; className?: string }) {
  const labels = useFlowLabels().editor;
  if (issues.errors === 0 && issues.warnings === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      {issues.errors > 0 && <span className="text-[var(--yk-danger)]">{labels.board.errors(issues.errors)}</span>}
      {issues.warnings > 0 && <span className="text-[var(--yk-accent-text)]">{labels.board.warnings(issues.warnings)}</span>}
    </span>
  );
}

/** Значок-кнопка без подписи: подпись — в `aria-label` и подсказке. */
export function IconButton({
  label,
  onClick,
  disabled,
  children,
  className,
  tone = "neutral",
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "danger";
}) {
  return (
    isValidElement(children)
      ? <DsButton variant="ghost" size="sm" icon={children.type as IconComponent} aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cn(tone === "danger" && "oduvanchik-flow-danger", className)} />
      : <DsButton variant="ghost" size="sm" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</DsButton>
  );
}

/** Панель справа: заголовок-надпись, заголовок, кнопки и содержимое с прокруткой. */
export function PanelShell({
  eyebrow,
  title,
  actions,
  children,
  label,
}: {
  eyebrow: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-2 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-normal font-mono uppercase tracking-wide text-[var(--yk-muted)]">{eyebrow}</p>
          <h2 className="mt-1 break-words text-xl font-semibold text-[var(--yk-text)]">{title}</h2>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <ScrollArea label={label} className="oduvanchik-flow-scroll flex flex-col gap-5 pl-5 pb-6">{children}</ScrollArea>
    </section>
  );
}
