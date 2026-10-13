import { useCallback, useEffect, useRef, useState } from "react";
import { AgentChat } from "../agent-chat";
import type { AgentChatProps } from "../agent-chat";
import type { ChatAccess } from "../chat-access";
import { useChatLabels } from "../labels";
import type { ChatSkin } from "../skin-contract";
import type { ChatListSkin } from "./chat-list-skin";
import { useChatList } from "./use-chat-list";
import { activeChatTitle, useChatListView } from "./use-chat-list-view";
import { useWorkspaceListSync } from "./use-workspace-list-sync";

export interface ChatWorkspaceProps extends Omit<AgentChatProps, "chatId" | "subject" | "skin" | "onBusyChange" | "onChatUnavailable" | "initialDraft"> {
  /** Скин чата плюс скин списка (например, `tandemSkin`). */
  skin: ChatSkin & ChatListSkin;
  /** Какой чат открыть первым, например из адреса страницы. Главнее запомненного; чата нет — «Чат не найден». */
  initialChatId?: string;
  /** Открытый чат сменился (выбор, создание, удаление): например, чтобы поменять адрес страницы. */
  onChatChange?: (chatId: string | null) => void;
}

/**
 * Чат со списком чатов рядом: выбрать, создать, переименовать, удалить. Всё видимое рисует скин. У открытого чата
 * запрещено право `chatList` — списка нет, только чат: он не показывается и не обновляется, пока права открытого чата неизвестны
 * (до первой истории) и если запрещён.
 */
export function ChatWorkspace({ skin, initialChatId, onChatChange, onChatAccessChange, ...chatProps }: ChatWorkspaceProps) {
  const labels = useChatLabels();
  const { api } = chatProps;
  const list = useChatList({ api, ...(initialChatId !== undefined && { initialChatId }), ...(chatProps.onTurnRefused && { onCreateRefused: chatProps.onTurnRefused }) });
  const [listOpen, setListOpen] = useState(false);
  const [activeBusy, setActiveBusy] = useState(false);
  const { activeChatId } = list;
  /**
   * Список показан только когда известно, что он разрешён: права приходят с первой историей открытого чата, и список,
   * который тут же спрятали бы (`chatList: false`), не должен мигать. Выбор другого чата список не прячет: права нового
   * чата приходят позже, а список в это время остаётся на месте. Не открылся чат или сам список — список виден: из него
   * выбирают другой чат.
   */
  const [listAllowed, setListAllowed] = useState(false);
  const reportAccess = useRef(onChatAccessChange);
  reportAccess.current = onChatAccessChange;
  const onActiveAccessChange = useCallback((access: ChatAccess) => {
    setListAllowed(access.capabilities.chatList);
    reportAccess.current?.(access);
  }, []);
  const onActiveChatUnavailable = useCallback(() => setListAllowed(true), []);
  const listShown = listAllowed || (activeChatId === null && list.status !== "loading");

  const reportChange = useRef(onChatChange);
  reportChange.current = onChatChange;
  useEffect(() => {
    reportChange.current?.(activeChatId);
  }, [activeChatId]);

  // Список скрыт — его не запрашивают: ни при смене занятости, ни ради названия чата.
  useWorkspaceListSync(list, activeBusy, listShown);
  const closeList = useCallback(() => setListOpen(false), []);
  const listView = useChatListView(list, closeList);

  return (
    <skin.ChatWorkspace
      activeTitle={activeChatTitle(list, labels)}
      listOpen={listOpen && listShown}
      onListOpenChange={setListOpen}
      {...(listShown && { list: <skin.ChatList {...listView} /> })}
    >
      {activeChatId !== null && (
        <AgentChat key={activeChatId} {...chatProps} chatId={activeChatId} skin={skin} onBusyChange={setActiveBusy} onChatAccessChange={onActiveAccessChange} onChatUnavailable={onActiveChatUnavailable} />
      )}
    </skin.ChatWorkspace>
  );
}
