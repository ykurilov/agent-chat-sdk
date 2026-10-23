import { TooltipProvider } from "@tandem/ui";
import { ScrollArea } from "@ykurilov/ds-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { OduvanchikSkinLabels } from "./tandem-labels";
import { OduvanchikWelcome } from "./welcome";

/** One scroll root: SDK virtualisation and reader anchoring own the forwarded DOM ref. */
export function OduvanchikLayout({ feed, composer, notice, scrollRef, announcement, empty }: ComponentProps<ChatSkin["Layout"]>) {
  const labels = useChatLabels();
  return <OduvanchikSkinLabels><TooltipProvider delayDuration={400}>
    <div className="oduvanchik-chat oduvanchik-thread-root">
      <ScrollArea ref={scrollRef} label={labels.agentPanelLabel} className="oduvanchik-thread-scroll">
        <div role="log" aria-live="off" className={`oduvanchik-thread${empty ? " oduvanchik-thread-empty" : ""}`}>
          {empty && <OduvanchikWelcome title={labels.welcome.title} description={labels.welcome.description} suggestions={[]} onPick={() => undefined} />}
          {feed}
        </div>
      </ScrollArea>
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {notice && <div className="oduvanchik-thread-notice">{notice}</div>}
      <div className="oduvanchik-composer-wrap"><div className="oduvanchik-composer-column">{composer}</div></div>
    </div>
  </TooltipProvider></OduvanchikSkinLabels>;
}
