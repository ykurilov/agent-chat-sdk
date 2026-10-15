import { Alert, Button, cn } from "@tandem/ui";
import { useSkillsLabels } from "@ykurilov/agent-chat-skills/react";
import type { SkillListProps } from "@ykurilov/agent-chat-skills/react";
import { Plus } from "lucide-react";
import { SkillStatusBadge } from "./skill-status-badge";

/** Список навыков: кнопка «Новый навык», строка на навык со статусом и числом загрузок. */
export function TandemSkillList({ state, items, creating, onCreate, onRetry }: SkillListProps) {
  const labels = useSkillsLabels();
  return (
    <div className="flex flex-col gap-3 p-3">
      <Button variant={creating ? "primary" : "secondary"} size="sm" aria-pressed={creating} onClick={onCreate} className="self-start">
        <Plus aria-hidden="true" className="size-4" />
        {labels.create}
      </Button>
      {state === "loading" && <p className="text-sm text-[var(--foreground-muted)]">{labels.loading}</p>}
      {state === "failed" && (
        <Alert
          variant="warm"
          title={labels.failed}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {labels.retry}
            </Button>
          }
        />
      )}
      {state === "ready" && items.length === 0 && <p className="text-sm text-[var(--foreground-muted)]">{labels.empty}</p>}
      {state === "ready" && items.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.name}>
              <button
                type="button"
                aria-current={item.selected || undefined}
                onClick={item.onSelect}
                className={cn(
                  "tandem-focus flex w-full min-w-0 flex-col gap-1 rounded-[var(--radius-nested)] border px-3 py-2 text-left transition-colors",
                  item.selected
                    ? "border-[var(--cool-border)] bg-[var(--cool-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-sm font-medium">{item.name}</span>
                  <SkillStatusBadge status={item.status} />
                </span>
                <span className="line-clamp-2 text-xs text-[var(--foreground-muted)]">{item.whenToUse}</span>
                <span className="text-xs text-[var(--foreground-subtle)]">{`${labels.versionLabel(item.version)} · ${labels.loadsCount(item.loads)} · ${item.updatedAt}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
