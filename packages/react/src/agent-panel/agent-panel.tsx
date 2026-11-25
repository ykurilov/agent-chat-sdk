import { PanelComposerBindingContext } from "../composer-helper-context";
import { useEffect, useRef } from "react";
import { AgentChat } from "../agent-chat";
import type { AgentChatProps } from "../agent-chat";
import type { ChatListSkin } from "../chat-list/chat-list-skin";
import { ChatTitleReportProvider, activeChatTitle, useReportedChatTitle } from "../chat-list/active-chat-title";
import { useChatListView } from "../chat-list/use-chat-list-view";
import { useChatLabels } from "../labels";
import type { ChatSkin } from "../skin-contract";
import type { AgentPanelSkin } from "./agent-panel-skin";
import { usePanelView } from "./panel-context";
import { SubjectChatLoading } from "../subject-chat/subject-chat-loading";
import { useSubjectChatId } from "../subject-chat/use-subject-chat-id";

export interface AgentPanelProps extends Omit<AgentChatProps, "api" | "chatId" | "subject" | "skin" | "onBusyChange" | "appBridge" | "initialDraft"> {
  /** Скин чата, списка и панели (например, `tandemSkin`). */
  skin: ChatSkin & ChatListSkin & AgentPanelSkin;
  /** `false` — встроенной плавающей кнопки нет: панель вызывает своя кнопка приложения (`useAgentPanelLauncher`). По умолчанию `true`. */
  launcher?: boolean;
}

/**
 * Кнопка агента и панель с открытым чатом и списком чатов поверх него. Всё видимое рисует скин.
 * Открытый чат смонтирован и при закрытой панели: ответ идёт, подписчики на изменения данных слышат его.
 */
export function AgentPanel({ skin, launcher = true, ...chatProps }: AgentPanelProps) {
  const view = usePanelView("AgentPanel");
  const labels = useChatLabels();
  const { controls, list, launcherRef, launchers, setBusy, subjectRequest } = view;
  const listView = useChatListView(list, view.closeList);
  const [reportedTitle, reportTitle] = useReportedChatTitle();

  // Закрылась: фокус был в панели (теперь скрытой) или потерян — вернуть его туда, откуда открыли. Фокус на странице не трогаем.
  const wasOpen = useRef(controls.open);
  useEffect(() => {
    if (wasOpen.current && !controls.open) {
      const focused = document.activeElement;
      if (focused === null || focused === document.body || focused.closest("[hidden], [inert]") !== null) launchers.focusTarget(launcherRef.current)?.focus();
    }
    wasOpen.current = controls.open;
  }, [controls.open, launcherRef, launchers]);

  const toggleByLauncher = () => {
    if (!controls.open && launcherRef.current) launchers.pressed(launcherRef.current);
    controls.toggle();
  };

  // Кнопку и панель убрали со страницы: о занятости открытого чата больше некому сообщить.
  useEffect(() => () => setBusy(false), [setBusy]);

  return (
    <>
      {launcher && <skin.AgentPanelLauncher open={controls.open} busy={controls.busy} onToggle={toggleByLauncher} buttonRef={launcherRef} />}
      <PanelComposerBindingContext.Provider value={true}>
      <ChatTitleReportProvider value={reportTitle}>
      <skin.AgentPanel
        open={controls.open}
        focusRequest={view.focusRequest}
        mode={controls.mode}
        width={controls.width}
        title={subjectRequest === null ? activeChatTitle(list, labels, reportedTitle) : ""}
        listOpen={view.listOpen}
        onListOpenChange={view.setListOpen}
        onClose={() => controls.setOpen(false)}
        onEscape={view.escape}
        list={<skin.ChatList {...listView} />}
      >
        {subjectRequest !== null ? (
          <PanelSubjectChat key={subjectRequest.nonce} request={subjectRequest} api={view.api} skin={skin} onFound={view.subjectFound} fetch={chatProps.transport?.fetch ?? chatProps.fetch} {...(chatProps.onTurnRefused && { onTurnRefused: chatProps.onTurnRefused })} />
        ) : list.activeChatId !== null && (
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
      </ChatTitleReportProvider>
      </PanelComposerBindingContext.Provider>
    </>
  );
}

/** Чат объекта ищется (`openSubject`): тот же вид, что у `AgentChat` с `subject`; найден — панель открывает его как обычный. */
function PanelSubjectChat({ request, api, fetch, skin, onFound, onTurnRefused }: {
  request: { key: string; nonce: number };
  api: string;
  fetch: typeof globalThis.fetch | undefined;
  skin: ChatSkin;
  onFound: (request: { key: string; nonce: number }, chatId: string) => void;
  onTurnRefused?: AgentChatProps["onTurnRefused"];
}) {
  const found = useSubjectChatId(api, request.key, onTurnRefused, fetch);
  const chatId = found.state === "ready" ? found.chatId : null;
  useEffect(() => {
    if (chatId !== null) onFound(request, chatId);
  }, [chatId, onFound, request]);
  if (found.state === "refused") return <skin.ErrorNotice kind="other" text={found.text} onRetry={found.retry} />;
  if (found.state === "failed") return <skin.ErrorNotice kind="other" onRetry={found.retry} />;
  return <SubjectChatLoading skin={skin} />;
}
