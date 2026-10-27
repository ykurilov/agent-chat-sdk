import { useEffect, useRef } from "react";
import { AgentChat } from "../agent-chat";
import type { AgentChatProps } from "../agent-chat";
import type { ChatListSkin } from "../chat-list/chat-list-skin";
import { activeChatTitle, useChatListView } from "../chat-list/use-chat-list-view";
import { useChatLabels } from "../labels";
import type { ChatSkin } from "../skin-contract";
import type { AgentPanelSkin } from "./agent-panel-skin";
import { usePanelView } from "./panel-context";

export interface AgentPanelProps extends Omit<AgentChatProps, "api" | "chatId" | "subject" | "skin" | "onBusyChange" | "appBridge" | "initialDraft"> {
  /** Скин чата, списка и панели (например, `tandemSkin`). */
  skin: ChatSkin & ChatListSkin & AgentPanelSkin;
}

/**
 * Кнопка агента и панель с открытым чатом и списком чатов поверх него. Всё видимое рисует скин.
 * Открытый чат смонтирован и при закрытой панели: ответ идёт, подписчики на изменения данных слышат его.
 */
export function AgentPanel({ skin, ...chatProps }: AgentPanelProps) {
  const view = usePanelView("AgentPanel");
  const labels = useChatLabels();
  const { controls, list, launcherRef, setBusy } = view;
  const listView = useChatListView(list, view.closeList);

  // Закрылась: фокус был в панели (теперь скрытой) или потерян — вернуть его на кнопку агента. Фокус на странице не трогаем.
  const wasOpen = useRef(controls.open);
  useEffect(() => {
    if (wasOpen.current && !controls.open) {
      const focused = document.activeElement;
      if (focused === null || focused === document.body || focused.closest("[hidden], [inert]") !== null) launcherRef.current?.focus();
    }
    wasOpen.current = controls.open;
  }, [controls.open, launcherRef]);

  // Кнопку и панель убрали со страницы: о занятости открытого чата больше некому сообщить.
  useEffect(() => () => setBusy(false), [setBusy]);

  return (
    <>
      <skin.AgentPanelLauncher open={controls.open} busy={controls.busy} onToggle={controls.toggle} buttonRef={launcherRef} />
      <skin.AgentPanel
        open={controls.open}
        focusRequest={view.focusRequest}
        mode={controls.mode}
        width={controls.width}
        title={activeChatTitle(list, labels)}
        listOpen={view.listOpen}
        onListOpenChange={view.setListOpen}
        onClose={() => controls.setOpen(false)}
        onEscape={view.escape}
        list={<skin.ChatList {...listView} />}
      >
        {list.activeChatId !== null && (
          <AgentChat
            key={view.chatKey}
            {...chatProps}
            api={view.api}
            chatId={list.activeChatId}
            skin={skin}
            onBusyChange={setBusy}
            appBridge={view.bridge}
            {...(view.initialDraft !== undefined && { initialDraft: view.initialDraft })}
          />
        )}
      </skin.AgentPanel>
    </>
  );
}
