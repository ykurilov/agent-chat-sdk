import type { ChatClosure } from "../chat-access";
import type { ChatOriginView } from "../skin-contract";
import type { ComponentType, ReactNode } from "react";

/** Строка списка чатов для скина. */
export interface ChatListItemView {
  id: string;
  /** `null` — у чата ещё нет названия: скин показывает надпись `chatListUntitled`, а в поле переименования ставит пустую строку. */
  title: string | null;
  /** Этот чат открыт. */
  active: boolean;
  /** Чат создан из мессенджера (версия 18): скин ставит пометку. Нет — чат из веба. */
  origin?: ChatOriginView;
  /** Чат закрыт: скин ставит пометку `chatListClosed`, причину (`message`) — подсказкой. Нет — чат открыт. */
  closed?: ChatClosure;
}

/** Окно подтверждения удаления. Удалить чат можно только через `onConfirm`. */
export interface ChatListDeleteRequestView {
  /** Название удаляемого чата. */
  title: string;
  /** Запрос на удаление ушёл, ждём ответа. */
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Договор скина, версия 7 (расширение «список чатов»; договор чата `ChatSkin` не менялся): только для `ChatWorkspace`.
 * Слой поведения решает, что показать и когда что-то удалять; скин рисует. Надписи компоненты берут из `useChatLabels()`.
 */
export interface ChatListSkin {
  /**
   * Каркас: список чатов и открытый чат. На широком экране список рядом с чатом; на узком — выезжающая панель
   * (открыта при `listOpen`), а название открытого чата и кнопка «Чаты» всегда на виду.
   */
  ChatWorkspace: ComponentType<{
    /** Нет (версия 20) — у открытого чата запрещено право `chatList`: списка и кнопки «Чаты» не рисовать, только чат. */
    list?: ReactNode;
    /** Открытый чат. */
    children: ReactNode;
    /** Название открытого чата для узкого экрана. */
    activeTitle: string;
    listOpen: boolean;
    onListOpenChange: (open: boolean) => void;
  }>;
  ChatList: ComponentType<{
    /** `loading` — список грузится, `error` — не загрузился (тогда `onRetry`), `ready` — `items` можно рисовать. */
    status: "loading" | "ready" | "error";
    items: ChatListItemView[];
    onSelect: (chatId: string) => void;
    /** «Новый чат». */
    onCreate: () => void;
    /** Новый чат создаётся: кнопку не нажимать повторно. */
    creating: boolean;
    /** Пустое и прежнее название слой поведения отбрасывает сам. */
    onRename: (chatId: string, title: string) => void;
    /** Просит подтверждения; сам ничего не удаляет. */
    onRequestDelete: (chatId: string) => void;
    /** Есть — показать окно подтверждения. */
    deleteRequest?: ChatListDeleteRequestView;
    /** Что пошло не так, готовой надписью (действие не удалось или список не загрузился). */
    error?: string;
    onRetry?: () => void;
  }>;
}
