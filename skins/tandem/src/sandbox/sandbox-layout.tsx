import { Button, Dialog, DialogContent, DialogTitle } from "@tandem/ui";
import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import { ScrollText } from "lucide-react";
import type { ComponentProps } from "react";
import { useScreenQuery } from "../screen-width";
import { TandemSkinLabels } from "../tandem-labels";

/** С этой ширины журнал стоит рядом с чатом; уже — выезжает панелью справа. */
const wideScreenQuery = "(min-width: 64rem)";

/** Каркас песочницы: над чатом шапка с инструкцией, журнал справа или в выдвижной панели. */
export function TandemSandboxLayout({ header, chat, journal, journalOpen, onJournalOpenChange }: ComponentProps<SandboxSkin["SandboxLayout"]>) {
  const labels = useSandboxLabels();
  const wide = useScreenQuery(wideScreenQuery, true);

  const chatPanel = (
    <section aria-label={labels.chatPanel} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-start gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
        <div className="min-w-0 flex-1">{header}</div>
        {!wide && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={journalOpen}
            onClick={() => onJournalOpenChange(!journalOpen)}
            className="h-9 shrink-0 gap-1.5 px-2 [&_svg]:size-4"
          >
            <ScrollText aria-hidden="true" />
            {labels.openJournal}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">{chat}</div>
    </section>
  );

  if (wide) {
    return (
      <TandemSkinLabels>
        <div className="flex h-full min-h-0 bg-[var(--canvas)]">
          {chatPanel}
          <section
            aria-label={labels.journalPanel}
            className="flex w-[28rem] shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)]"
          >
            {journal}
          </section>
        </div>
      </TandemSkinLabels>
    );
  }

  return (
    <TandemSkinLabels>
      <div className="flex h-full min-h-0 flex-col bg-[var(--canvas)]">
        {chatPanel}
        <Dialog open={journalOpen} onOpenChange={onJournalOpenChange}>
          <DialogContent side="right" aria-describedby={undefined} className="flex w-[min(28rem,100vw)] flex-col">
            <DialogTitle className="px-4 pb-1 pt-4 text-sm font-semibold text-[var(--foreground-muted)]">{labels.journalPanel}</DialogTitle>
            <div className="min-h-0 flex-1 overflow-y-auto">{journal}</div>
          </DialogContent>
        </Dialog>
      </div>
    </TandemSkinLabels>
  );
}
