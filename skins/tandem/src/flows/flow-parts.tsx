import { cn } from "@tandem/ui";
import type { FlowEdgeKind, FlowIssueCount } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Clock, Database, MessageSquareText, Undo2, Zap, type LucideIcon } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";

// Общие мелочи скина редактора: цвета и значки видов условий, подписи разделов, выпадающий список, счётчик ошибок.

/** Цвет вида стрелки: словами — действие, данные — приглушённый, событие — успех, таймер — тёплый пунктиром. */
export const KIND_COLOR: Record<FlowEdgeKind, string> = {
  judge: "var(--action)",
  data: "var(--foreground-subtle)",
  event: "var(--success)",
  timer: "var(--warm)",
  return: "var(--foreground-subtle)",
};

export const KIND_DASH: Record<FlowEdgeKind, string | undefined> = {
  judge: undefined,
  data: undefined,
  event: undefined,
  timer: "6 5",
  return: "2 4",
};

export const KIND_ICON: Record<FlowEdgeKind, LucideIcon> = {
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
  return <h3 className={cn("text-xs font-semibold uppercase tracking-wide text-[var(--foreground-subtle)]", className)}>{children}</h3>;
}

/** Обычный `select` в оформлении полей Тандема. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-[var(--control-height-md)] w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-60",
        className,
      )}
    >
      {children}
    </select>
  );
}

/** Подпись над полем ввода. */
export function Labeled({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--foreground-muted)]">{hint}</span>}
    </label>
  );
}

/** «Ошибок: 2 · Замечаний: 1» — красным и тёплым; ничего — ничего. */
export function IssueBadge({ issues, className }: { issues: FlowIssueCount; className?: string }) {
  const labels = useFlowLabels().editor;
  if (issues.errors === 0 && issues.warnings === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      {issues.errors > 0 && <span className="text-[var(--destructive-text)]">{labels.board.errors(issues.errors)}</span>}
      {issues.warnings > 0 && <span className="text-[var(--warm-text)]">{labels.board.warnings(issues.warnings)}</span>}
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
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-small)] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-35",
        tone === "danger" && "text-[var(--destructive-text)] hover:text-[var(--destructive-text)]",
        className,
      )}
    >
      {children}
    </button>
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
    <section aria-label={label} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-2 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-subtle)]">{eyebrow}</p>
          <h2 className="mt-1 break-words text-xl font-semibold text-[var(--foreground)]">{title}</h2>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-6">{children}</div>
    </section>
  );
}
