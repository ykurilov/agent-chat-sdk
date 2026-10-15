import { Card } from "@tandem/ui";
import { useSkillsLabels } from "@ykurilov/agent-chat-skills/react";
import type { SkillLoadsProps } from "@ykurilov/agent-chat-skills/react";

/** Учёт: сколько раз агент загружал навык и последние чаты. */
export function TandemSkillLoads({ total, recent }: SkillLoadsProps) {
  const labels = useSkillsLabels();
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{labels.loads}</h3>
        <span className="text-xs text-[var(--foreground-muted)]">{labels.loadsTotal(total)}</span>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">{labels.noLoads}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-xs text-[var(--foreground-muted)]">
          {recent.map((load, index) => (
            <li key={`${load.chatId}-${index}`} className="break-words font-mono">
              {labels.loadRow(load.chatId, load.ownerId, load.version, load.loadedAt)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
