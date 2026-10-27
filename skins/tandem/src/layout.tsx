import { TooltipProvider } from "@tandem/ui";
import { useChatViewport } from "@ykurilov/agent-chat-react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { createElement, useRef } from "react";
import type { ComponentProps } from "react";
import { TandemSkinLabels } from "./tandem-labels";

/**
 * Лента во всю высоту и поле ввода внизу; на телефоне отступы меньше. Прокрутку и прилипание
 * к низу ведёт слой поведения через `scrollRef`. Промежутки между сообщениями — внутренние
 * отступы самих сообщений: лента окном не держит `gap`.
 */
export function TandemLayout({ feed, composer, notice, scrollRef, announcement, header, completion }: ComponentProps<ChatSkin["Layout"]>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useChatViewport(viewportRef);
  return (
    <TandemSkinLabels>
      <TooltipProvider delayDuration={400}>
        <div ref={viewportRef} className="flex h-full min-h-0 flex-col bg-[var(--canvas)]">
          {header && <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-3 py-4 sm:px-6">{createElement(`h${header.headingLevel ?? 1}`, { className: "font-semibold" }, header.title)}<div className="ml-auto">{header.aside}</div></header>}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div role="log" aria-live="off" className="mx-auto max-w-3xl px-3 pb-0 pt-5 sm:px-6 sm:pb-2 sm:pt-8">
              {feed}
              {completion}
            </div>
          </div>
          <div className="sr-only" aria-live="polite">
            {announcement}
          </div>
          {/* Пустая область для диктора (`data-spending-empty`) места не занимает. */}
          {notice && <div className="mx-auto w-full max-w-3xl px-3 pb-3 has-[>[data-spending-empty]:only-child]:pb-0 sm:px-6">{notice}</div>}
          <div data-agent-chat-composer="" hidden={completion != null && completion !== false} className="border-t border-[var(--border)] bg-[var(--surface)] px-3 py-3 pb-[max(0.75rem,var(--agent-chat-safe-area-bottom,env(safe-area-inset-bottom)))] sm:px-6 sm:py-4">
            <div className="mx-auto max-w-3xl">{composer}</div>
          </div>
        </div>
      </TooltipProvider>
    </TandemSkinLabels>
  );
}
