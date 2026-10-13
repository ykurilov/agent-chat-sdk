import { useCallback } from "react";
import type { ComponentProps } from "react";
import { closureOf } from "../chat-access";
import { useChatLabels } from "../labels";
import type { ChatLabels } from "../labels";
import type { ChatOriginView } from "../skin-contract";
import type { ChatListSkin } from "./chat-list-skin";
import type { ChatListActionError, ChatListState } from "./use-chat-list";

export type ChatListViewProps = ComponentProps<ChatListSkin["ChatList"]>;

/**
 * Что получает `skin.ChatList`: строки, действия, подтверждение удаления и ошибка готовой надписью.
 * `onChosen` — чат выбран или создан (например, чтобы закрыть список поверх чата). Общее у `ChatWorkspace` и панели агента.
 */
export function useChatListView(list: ChatListState, onChosen: () => void): ChatListViewProps {
  const labels = useChatLabels();
  const { select, create: createChat } = list;
  const onSelect = useCallback(
    (chatId: string) => {
      select(chatId);
      onChosen();
    },
    [onChosen, select],
  );
  const onCreate = useCallback(() => {
    void createChat().then((opened) => opened && onChosen());
  }, [createChat, onChosen]);

  const deleteRequest = list.deleteRequest && {
    title: list.deleteRequest.title ?? labels.chatListUntitled,
    pending: list.deleting,
    onConfirm: () => void list.confirmDelete(),
    onCancel: list.cancelDelete,
  };
  const error =
    list.status === "error"
      ? labels.chatListLoadFailed
      : list.error === "create" && list.creationRefusal
        ? list.creationRefusal.message
        : list.error
          ? actionErrorText(labels, list.error)
          : undefined;
  return {
    status: list.status,
    items: list.items.map((item) => {
      const origin = chatOriginOf(item.origin);
      const closed = closureOf(item.closed);
      return { id: item.id, title: item.title, active: item.id === list.activeChatId, ...(origin && { origin }), ...(closed && { closed }) };
    }),
    onSelect,
    onCreate,
    creating: list.creating,
    onRename: (chatId, title) => void list.rename(chatId, title),
    onRequestDelete: list.requestDelete,
    ...(deleteRequest && { deleteRequest }),
    ...(error && { error }),
    ...(list.status === "error" && { onRetry: list.reload }),
  };
}

/** Название открытого чата для шапки; нет названия или чата нет в списке — «Новый чат». */
export function activeChatTitle(list: Pick<ChatListState, "items" | "activeChatId">, labels: ChatLabels): string {
  return list.items.find((item) => item.id === list.activeChatId)?.title ?? labels.chatListUntitled;
}

function actionErrorText(labels: ChatLabels, error: ChatListActionError): string {
  switch (error) {
    case "create":
      return labels.chatListCreateFailed;
    case "rename":
      return labels.chatListRenameFailed;
    case "delete":
      return labels.chatListDeleteFailed;
  }
}

const CHAT_ORIGINS: ReadonlySet<string> = new Set<ChatOriginView>(["telegram", "vk", "max"]);
/** Пометка только для знакомых мессенджеров: незнакомое значение сервера скин не получает. */
const chatOriginOf = (origin: string | undefined): ChatOriginView | undefined =>
  origin !== undefined && CHAT_ORIGINS.has(origin) ? (origin as ChatOriginView) : undefined;
