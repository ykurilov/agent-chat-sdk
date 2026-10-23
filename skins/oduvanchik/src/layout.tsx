import { TooltipProvider } from "@tandem/ui";
import { ChatHeader, ScrollArea } from "@ykurilov/ds-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useEffect, useState } from "react";
import type { ComponentProps, CSSProperties } from "react";
import { OduvanchikSkinLabels } from "./tandem-labels";
import { OduvanchikWelcome } from "./welcome";

/** One scroll root: SDK virtualisation and reader anchoring own the forwarded DOM ref. */
export function OduvanchikLayout({ feed, composer, notice, scrollRef, announcement, empty, header, completion }: ComponentProps<ChatSkin["Layout"]>) {
  const labels = useChatLabels();
  const [scrolled, setScrolled] = useState(false);
  const [gutter, setGutter] = useState(0);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => setScrolled(scroller.scrollTop > 0);
    update();
    // Equal column edges without clipping composer popovers. Native gutter measurement,
    // independent of virtual content height, also handles overlay scrollbars (zero).
    const measure = () => {
      setGutter(Math.max(0, scroller.offsetWidth - scroller.clientWidth) / 2);
      // Initial positioning can precede native scroll delivery. Sample the same
      // real scroll root on its first layout measurement as well.
      update();
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(scroller);
    scroller.addEventListener("scroll", update, { passive: true });
    return () => { scroller.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [scrollRef]);
  const completed = completion != null && completion !== false;
  return <OduvanchikSkinLabels><TooltipProvider delayDuration={400}>
    <div className="oduvanchik-chat oduvanchik-thread-root" style={{ "--oduvanchik-scrollbar-gutter": `${gutter}px` } as CSSProperties}>
      {header && <ChatHeader {...header} scrolled={scrolled} />}
      <ScrollArea ref={scrollRef} label={labels.agentPanelLabel} className="oduvanchik-thread-scroll">
        <div role="log" aria-live="off" className={`yk-chat-column oduvanchik-thread${empty ? " oduvanchik-thread-empty" : ""}`}>
          {empty && <OduvanchikWelcome title={labels.welcome.title} description={labels.welcome.description} suggestions={[]} onPick={() => undefined} />}
          {feed}
          {completion}
        </div>
      </ScrollArea>
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {notice && <div className="oduvanchik-thread-notice">{notice}</div>}
      <div className="oduvanchik-composer-wrap" hidden={completed}><div className="yk-chat-column oduvanchik-composer-column">{composer}</div></div>
    </div>
  </TooltipProvider></OduvanchikSkinLabels>;
}
