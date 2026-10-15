import { useSkillsLabels } from "@ykurilov/agent-chat-skills/react";

/** Не-админ: экрана будто нет. */
export function TandemSkillsNotFound() {
  const labels = useSkillsLabels();
  return (
    <div className="flex h-full items-center justify-center bg-[var(--canvas)] p-6">
      <p className="text-base text-[var(--foreground-muted)]">{labels.notFound}</p>
    </div>
  );
}
