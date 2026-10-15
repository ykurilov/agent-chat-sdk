import { Alert, Button } from "@tandem/ui";
import { useSkillsLabels } from "@ykurilov/agent-chat-skills/react";
import type { SkillPanelProps } from "@ykurilov/agent-chat-skills/react";

/** Карточка навыка: форма, история версий и учёт загрузок; пока ничего не выбрано — подсказка. */
export function TandemSkillPanel({ state, onRetry, editor, versions, loads }: SkillPanelProps) {
  const labels = useSkillsLabels();
  if (state === "empty") return <p className="p-6 text-sm text-[var(--foreground-muted)]">{labels.pickSkill}</p>;
  if (state === "loading") return <p className="p-6 text-sm text-[var(--foreground-muted)]">{labels.loading}</p>;
  if (state === "failed") {
    return (
      <div className="p-4">
        <Alert
          variant="warm"
          title={labels.failed}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {labels.retry}
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      {editor}
      {versions}
      {loads}
    </div>
  );
}
