import { Alert, Button, Card, cn } from "@tandem/ui";
import { useSkillsLabels } from "@ykurilov/agent-chat-skills/react";
import type { DiffLine, SkillVersionsProps } from "@ykurilov/agent-chat-skills/react";

const marks = { same: " ", added: "+", removed: "−" } as const;

/** Разница строк: добавленные — зелёным, убранные — красным, остальное — как есть. Текст только как текст. */
function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--canvas)] py-1 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div
          key={index}
          data-diff={line.kind}
          className={cn(
            "whitespace-pre-wrap break-words px-2",
            line.kind === "added" && "bg-[var(--success-soft)] text-[var(--success-text)]",
            line.kind === "removed" && "bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] text-[var(--destructive-text)]",
            line.kind === "same" && "text-[var(--foreground-muted)]",
          )}
        >
          <span aria-hidden="true" className="mr-2 select-none">
            {marks[line.kind]}
          </span>
          {line.text}
        </div>
      ))}
    </pre>
  );
}

/** История версий: новые сверху, у каждой — что изменилось и «Вернуть версию». */
export function TandemSkillVersions({ state, versions, rollingBack, onRetry }: SkillVersionsProps) {
  const labels = useSkillsLabels();
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold">{labels.versions}</h3>
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
      {state === "ready" && (
        <ol className="flex flex-col gap-2">
          {versions.map((version) => (
            <li key={version.version} className="flex flex-col gap-2 rounded-[var(--radius-nested)] border border-[var(--border)] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0">{labels.versionRow(version.version, version.author, version.createdAt)}</span>
                {version.current && <span className="text-xs text-[var(--success-text)]">{labels.current}</span>}
                <span className="ml-auto flex gap-1">
                  <Button variant="ghost" size="sm" aria-expanded={version.open} onClick={() => version.onOpenChange(!version.open)}>
                    {version.open ? labels.hideChanges : labels.showChanges}
                  </Button>
                  {version.onRollback && (
                    <Button variant="secondary" size="sm" onClick={version.onRollback} disabled={rollingBack}>
                      {rollingBack ? labels.rollingBack : labels.rollback(version.version)}
                    </Button>
                  )}
                </span>
              </div>
              {version.open && (
                <div className="flex flex-col gap-2">
                  {version.whenToUseDiff && version.whenToUseDiff.some((line) => line.kind !== "same") && (
                    <>
                      <span className="text-xs text-[var(--foreground-muted)]">{labels.whenToUse}</span>
                      <Diff lines={version.whenToUseDiff} />
                    </>
                  )}
                  {version.bodyDiff && (
                    <>
                      <span className="text-xs text-[var(--foreground-muted)]">{labels.body}</span>
                      <Diff lines={version.bodyDiff} />
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
