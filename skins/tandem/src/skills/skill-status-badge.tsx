import { Badge } from "@tandem/ui";
import { useSkillsLabels } from "@ykurilov/agent-chat-skills/react";
import type { SkillStatus } from "@ykurilov/agent-chat-skills/react";

const variants = { off: "neutral", admins: "cool", everyone: "success" } as const;

export function SkillStatusBadge({ status }: { status: SkillStatus }) {
  const labels = useSkillsLabels();
  return (
    <Badge variant={variants[status]} className="shrink-0 py-0.5 font-medium" data-status={status}>
      {labels.statuses[status]}
    </Badge>
  );
}
