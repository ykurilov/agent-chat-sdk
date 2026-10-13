import type { ComponentType, ReactNode, Ref } from "react";

/**
 * Договор скина, версия 12: отдельный интерфейс для боковой панели агента (`AgentPanel` из `@ykurilov/agent-chat-react/panel`).
 * `ChatSkin`, `ChatListSkin` (версия 7) и `MemorySkin` (версия 11) не менялись. Скин без `AgentPanelSkin` работает как раньше,
 * но для панели не годится (ошибка типов). Надписи компоненты берут из `useChatLabels()`.
 */
export interface AgentPanelSkin {
  /** Кнопка агента в углу страницы. Положение и вид — дело скина. */
  AgentPanelLauncher: ComponentType<{
    open: boolean;
    /** Идёт ответ в открытом чате: показать значок. */
    busy: boolean;
    onToggle: () => void;
    /** Сюда слой поведения возвращает фокус при закрытии. */
    buttonRef: Ref<HTMLButtonElement>;
  }>;
  /**
   * Рамка панели. Смонтирована всегда; закрытая — скрыта (`hidden`/`inert`), содержимое живёт.
   * Страница под панелью не затемняется и остаётся кликабельной. При переходе `open: false → true` фокус уходит в поле ввода внутри рамки;
   * роль `complementary` или `dialog` без `aria-modal`, `aria-label` из словаря. На экране ≤ 640 px панель на весь экран,
   * «Закрыть» всегда видна, горизонтальной прокрутки нет.
   */
  AgentPanel: ComponentType<{
    open: boolean;
    mode: "overlay" | "push";
    /** Ширина на широком экране, px. */
    width: number;
    /** Название открытого чата (или «Новый чат»). */
    title: string;
    /** Список открыт поверх чата. */
    listOpen: boolean;
    onListOpenChange: (open: boolean) => void;
    onClose: () => void;
    /** Esc внутри панели. Слой поведения сам решает: закрыть список или панель. Список закрылся и фокус пропал — верните его в поле ввода. */
    onEscape: () => void;
    /** Открытый чат (`AgentChat`). */
    children: ReactNode;
    /** Список чатов (`skin.ChatList`); рисовать поверх чата, когда `listOpen`. */
    list: ReactNode;
  }>;
}
