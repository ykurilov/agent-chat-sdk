import { useEffect, useRef } from "react";
import type { AgentPanelSkin } from "../../src/agent-panel/agent-panel-skin";
import type { ChatListSkin } from "../../src/chat-list/chat-list-skin";
import { useChatLabels } from "../../src/labels";
import type { ChatSkin } from "../../src/skin-contract";
import { stubWorkspaceSkin } from "./stub-chat-list-skin";

/**
 * Пробный скин панели (договор v12) для тестов слоя поведения: пропсы видны в data-атрибутах, надписи — из словаря.
 * Обязанности рамки выполняет как настоящий скин: закрытая — `hidden`, при открытии фокус в поле ввода, Esc — `onEscape`.
 */
export const stubAgentPanelSkin: AgentPanelSkin = {
  AgentPanelLauncher: function StubLauncher({ open, busy, onToggle, buttonRef }) {
    const labels = useChatLabels();
    return (
      <button type="button" ref={buttonRef} data-testid="launcher" aria-expanded={open} data-busy={String(busy)} onClick={onToggle}>
        {labels.agentPanelLauncher}
      </button>
    );
  },
  AgentPanel: function StubPanel({ open, focusRequest = 0, mode, width, title, listOpen, onListOpenChange, onClose, onEscape, children, list }) {
    const labels = useChatLabels();
    const frame = useRef<HTMLElement>(null);
    const wasOpen = useRef(open);
    const lastFocusRequest = useRef(0);
    useEffect(() => {
      if (open && !listOpen && (!wasOpen.current || lastFocusRequest.current !== focusRequest)) {
        const field = frame.current?.querySelector("textarea");
        if (field) { field.focus(); lastFocusRequest.current = focusRequest; }
      }
      wasOpen.current = open;
    }, [open, listOpen, focusRequest, children]);
    return (
      <aside
        ref={frame}
        role="complementary"
        aria-label={labels.agentPanelLabel}
        data-testid="panel"
        data-mode={mode}
        data-width={width}
        data-list-open={String(listOpen)}
        hidden={!open}
        onKeyDown={(event) => event.key === "Escape" && onEscape()}
      >
        <h2 data-testid="panel-title">{title}</h2>
        <button type="button" data-testid="panel-list-toggle" onClick={() => onListOpenChange(!listOpen)}>
          {listOpen ? labels.agentPanelBackToChat : labels.agentPanelChats}
        </button>
        <button type="button" data-testid="panel-close" onClick={onClose}>
          {labels.agentPanelClose}
        </button>
        <section data-testid="panel-chat">{children}</section>
        {listOpen && <nav data-testid="panel-list">{list}</nav>}
      </aside>
    );
  },
};

/** Всё, что принимает `AgentPanel`: чат, список и панель. */
export const stubPanelSkin: ChatSkin & ChatListSkin & AgentPanelSkin = { ...stubWorkspaceSkin, ...stubAgentPanelSkin };
