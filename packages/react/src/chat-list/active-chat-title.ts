import { createContext, useCallback, useContext, useState } from "react";
import type { ChatLabels } from "../labels";
import type { ChatListState } from "./use-chat-list";

/** Название чата из его истории (`chat.title`); `null` — у чата нет названия. */
export interface ReportedChatTitle {
  chatId: string;
  title: string | null;
}

type ReportChatTitle = (reported: ReportedChatTitle) => void;

/** Куда открытый чат сообщает своё название: панель агента и `ChatWorkspace` берут его для чатов не из списка. */
const ChatTitleReportContext = createContext<ReportChatTitle | null>(null);
export const ChatTitleReportProvider = ChatTitleReportContext.Provider;

/** Функция, которой `useAgentChat` сообщает название чата из истории; вне панели и `ChatWorkspace` — `null`. */
export const useChatTitleReport = (): ReportChatTitle | null => useContext(ChatTitleReportContext);

/** Названия чатов из их историй по id чата. */
export type ReportedChatTitles = Readonly<Record<string, string | null>>;

/** Названия, сообщённые чатами, и функция для `ChatTitleReportProvider`. Поздний отчёт прежнего чата не трогает название открытого. */
export function useReportedChatTitle(): [ReportedChatTitles, ReportChatTitle] {
  const [reported, setReported] = useState<ReportedChatTitles>({});
  const report = useCallback((next: ReportedChatTitle) => {
    setReported((current) => (current[next.chatId] === next.title ? current : { ...current, [next.chatId]: next.title }));
  }, []);
  return [reported, report];
}

/**
 * Название открытого чата для шапки. Название из списка главнее (оно же меняется переименованием). Чата нет в списке
 * (чат объекта) или в списке он без названия — название из его истории. Нет нигде — «Новый чат».
 */
export function activeChatTitle(
  list: Pick<ChatListState, "items" | "activeChatId">,
  labels: ChatLabels,
  reported: ReportedChatTitles,
): string {
  const { activeChatId } = list;
  if (activeChatId === null) return labels.chatListUntitled;
  const listed = list.items.find((item) => item.id === activeChatId)?.title;
  return listed ?? reported[activeChatId] ?? labels.chatListUntitled;
}
