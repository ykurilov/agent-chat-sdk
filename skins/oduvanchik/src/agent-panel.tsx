import { Sphere } from "@ykurilov/ds-react";
import { Button, buttonVariants, cn } from "@tandem/ui";
import type { AgentPanelSkin } from "@ykurilov/agent-chat-react/panel";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ArrowLeft, List, Sparkles, X } from "./icons";
import { useEffect, useRef } from "react";
import type { ComponentProps, CSSProperties, KeyboardEvent } from "react";
import { OduvanchikSkinLabels } from "./tandem-labels";

/**
 * Кнопка агента в правом нижнем углу страницы: значок и слово «Агент». Пока идёт ответ, на значке крутится кружок
 * и есть скрытая надпись «Агент отвечает». Не меньше 44 пунктов: такую кнопку нажимают на ходу.
 */
export function OduvanchikAgentPanelLauncher({ open, busy, onToggle, buttonRef }: ComponentProps<AgentPanelSkin["AgentPanelLauncher"]>) {
  const labels = useChatLabels();
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-label={open ? labels.agentPanelClose : labels.agentPanelOpen}
      onClick={onToggle}
      style={{ minWidth: 44, minHeight: 44, "--action-hover": "var(--yk-surface-2)" } as CSSProperties}
      className={cn("oduvanchik-chat",
        buttonVariants({ variant: "primary", size: "md" }),
        "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 rounded-full shadow-lg",
      )}
    >
      {busy ? <Sphere size={20} /> : <Sparkles aria-hidden="true" />}
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
export function OduvanchikAgentPanel({
  open,
  focusRequest = 0,
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
  const lastFocusRequest = useRef(0);
  useEffect(() => {
    if (open && !listOpen && (!wasOpen.current || lastFocusRequest.current !== focusRequest)) {
      const field = panelRef.current?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)");
      if (field) {
        field.focus();
        lastFocusRequest.current = focusRequest;
      }
    }
    wasOpen.current = open;
  }, [open, listOpen, focusRequest, children]);

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
    <OduvanchikSkinLabels>
      <aside
        ref={panelRef}
        aria-label={labels.agentPanelLabel}
        hidden={!open}
        inert={!open}
        data-mode={mode}
        onKeyDown={handleKeyDown}
        style={{ "--agent-panel-width": `${width}px` } as CSSProperties}
        className={cn("oduvanchik-chat",
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
    </OduvanchikSkinLabels>
  );
}
