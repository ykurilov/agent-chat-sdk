import { TooltipProvider } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { OduvanchikSkinLabels } from "./tandem-labels";

/**
 * Лента во всю высоту и поле ввода внизу; на телефоне отступы меньше. Прокрутку и прилипание
 * к низу ведёт слой поведения через `scrollRef`. Промежутки между сообщениями — внутренние
 * отступы самих сообщений: лента окном не держит `gap`.
 */
export function OduvanchikLayout({ feed, composer, notice, scrollRef, announcement }: ComponentProps<ChatSkin["Layout"]>) {
  return (
    <OduvanchikSkinLabels>
      <TooltipProvider delayDuration={400}>
        <div className="oduvanchik-chat flex h-full min-h-0 flex-col bg-[var(--canvas)]">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div role="log" aria-live="off" className="mx-auto max-w-3xl px-3 pb-0 pt-5 sm:px-6 sm:pb-2 sm:pt-8">
              {feed}
            </div>
          </div>
          <div className="sr-only" aria-live="polite">
            {announcement}
          </div>
          {/* Пустая область для диктора (`data-spending-empty`) места не занимает. */}
          {notice && <div className="mx-auto w-full max-w-3xl px-3 pb-3 has-[>[data-spending-empty]:only-child]:pb-0 sm:px-6">{notice}</div>}
          <div className="oduvanchik-composer-wrap bg-[var(--surface)] px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <div className="mx-auto max-w-3xl">{composer}</div>
          </div>
        </div>
      </TooltipProvider>
    </OduvanchikSkinLabels>
  );
}
