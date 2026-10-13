import { Button, buttonVariants, cn } from "@tandem/ui";
import type { AgentPanelSkin } from "@ykurilov/agent-chat-react/panel";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ArrowLeft, List, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ComponentProps, CSSProperties, KeyboardEvent } from "react";
import { TandemSkinLabels } from "./tandem-labels";

/**
 * Кнопка агента в правом нижнем углу страницы: значок и слово «Агент». Пока идёт ответ, на значке крутится кружок
 * и есть скрытая надпись «Агент отвечает». Не меньше 44 пунктов: такую кнопку нажимают на ходу.
 */
export function TandemAgentPanelLauncher({ open, busy, onToggle, buttonRef }: ComponentProps<AgentPanelSkin["AgentPanelLauncher"]>) {
  const labels = useChatLabels();
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-label={open ? labels.agentPanelClose : labels.agentPanelOpen}
      onClick={onToggle}
      style={{ minWidth: 44, minHeight: 44 }}
      className={cn(
        buttonVariants({ variant: "primary", size: "md" }),
        "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 rounded-full shadow-lg",
      )}
    >
      {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Sparkles aria-hidden="true" />}
      <span aria-hidden="true">{labels.agentPanelLauncher}</span>
      {busy && <span className="sr-only">{labels.agentPanelBusy}</span>}
    </button>
  );
}

/**
 * Рамка панели у правого края, во всю высоту; страницу не затемняет и клики пропускает мимо себя.
 * Ширина — от `width`, но на экране до 640 пунктов панель занимает весь экран. Закрытая остаётся в разметке (`hidden`, `inert`):
 * чат внутри живёт. Список чатов выезжает поверх чата, сам чат на это время недоступен.
 */
export function TandemAgentPanel({
  open,
  mode,
  width,
  title,
  listOpen,
  onListOpenChange,
  onClose,
  onEscape,
  children,
  list,
}: ComponentProps<AgentPanelSkin["AgentPanel"]>) {
  const labels = useChatLabels();
  const panelRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    wasOpen.current = open;
  }, [open]);

  // Список закрылся (Esc, выбор чата), а фокус был в нём и пропал — вернуть его в поле ввода: следующий Esc дойдёт до панели.
  const wasListOpen = useRef(listOpen);
  useEffect(() => {
    const focused = document.activeElement;
    if (wasListOpen.current && !listOpen && (focused === null || focused === document.body)) {
      panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    }
    wasListOpen.current = listOpen;
  }, [listOpen]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !event.defaultPrevented) onEscape();
  }

  return (
    <TandemSkinLabels>
      <aside
        ref={panelRef}
        aria-label={labels.agentPanelLabel}
        hidden={!open}
        inert={!open}
        data-mode={mode}
        onKeyDown={handleKeyDown}
        style={{ "--agent-panel-width": `${width}px` } as CSSProperties}
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-full min-w-0 flex-col overflow-x-hidden border-l border-[var(--border)] bg-[var(--surface)] min-[641px]:w-[var(--agent-panel-width)]",
          mode === "overlay" && "shadow-xl",
          open ? "flex" : "hidden",
        )}
      >
        <header className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1.5">
          <Button
            variant="ghost"
            size="md"
            aria-expanded={listOpen}
            onClick={() => onListOpenChange(!listOpen)}
            style={{ minHeight: 44 }}
            className="shrink-0"
          >
            {listOpen ? <ArrowLeft aria-hidden="true" /> : <List aria-hidden="true" />}
            {listOpen ? labels.agentPanelBackToChat : labels.agentPanelChats}
          </Button>
          <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-[var(--foreground)]">{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={labels.agentPanelClose}
            onClick={onClose}
            style={{ minWidth: 44, minHeight: 44 }}
            className="shrink-0"
          >
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="relative min-h-0 flex-1">
          <div inert={listOpen} className="h-full min-h-0">
            {children}
          </div>
          {listOpen && <div className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-[var(--surface)] px-2 py-3">{list}</div>}
        </div>
      </aside>
    </TandemSkinLabels>
  );
}
