import { useSkillsLabels } from "@ykurilov/agent-chat-skills/react";
import type { SkillsLayoutProps } from "@ykurilov/agent-chat-skills/react";
import { TandemSkinLabels } from "../tandem-labels";

/** Экран навыков: заголовок, список слева и карточка справа; на узком экране — друг под другом. */
export function TandemSkillsLayout({ list, detail }: SkillsLayoutProps) {
  const labels = useSkillsLabels();
  return (
    <TandemSkinLabels>
      <div className="flex h-full min-h-0 flex-col bg-[var(--canvas)] text-[var(--foreground)]">
        <h1 className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base font-semibold">{labels.title}</h1>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <aside className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] md:w-80 md:overflow-y-auto md:border-b-0 md:border-r">{list}</aside>
          <main className="min-w-0 flex-1 md:overflow-y-auto">{detail}</main>
        </div>
      </div>
    </TandemSkinLabels>
  );
}
