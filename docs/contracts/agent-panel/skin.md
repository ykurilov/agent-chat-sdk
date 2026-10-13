# Договор скина, версия 12: панель агента (021)

Отдельный интерфейс `AgentPanelSkin` (файл `packages/react/src/agent-panel/agent-panel-skin.ts`). `ChatSkin`, `ChatListSkin` (v7) и `MemorySkin` (v11) не меняются. Скин без `AgentPanelSkin` работает как раньше; панели он не годится (ошибка типов). Скин Тандема реализует v12.

```ts
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
  /** Рамка панели. Смонтирована всегда; закрытая — скрыта (`hidden`/`inert`), содержимое живёт. */
  AgentPanel: ComponentType<{
    open: boolean;
    mode: "overlay" | "push";
    /** Ширина на широком экране, px. На экране ≤ 640 px панель на весь экран. */
    width: number;
    /** Название открытого чата (или «Новый чат»). */
    title: string;
    /** Список открыт поверх чата. */
    listOpen: boolean;
    onListOpenChange: (open: boolean) => void;
    onClose: () => void;
    /** Esc внутри панели. Слой поведения сам решает, закрывать ли. */
    onEscape: () => void;
    /** Открытый чат (`AgentChat`). */
    children: ReactNode;
    /** Список чатов (`skin.ChatList`); рисовать поверх чата, когда `listOpen`. */
    list: ReactNode;
  }>;
}
```

Обязанности скина:

- Без затемнения страницы; страница под панелью видна и кликабельна (FR-007). `push` — та же рамка; отступ странице даёт приложение по `pageInset`.
- При переходе `open: false → true` — фокус в поле ввода внутри рамки (первое `textarea` или элемент, который скин пометил); роль `complementary` или `dialog` без `aria-modal`, `aria-label` из словаря.
- При переходе `listOpen: true → false`, если фокус пропал вместе со списком, — фокус в поле ввода: второй Esc должен дойти до рамки и закрыть панель.
- Узкий экран (≤ 640 px): на весь экран, «Закрыть» всегда видна, без горизонтальной прокрутки.
- Надписи — из `useChatLabels()`.

## Словарь (`ChatLabels`, новые ключи)

| Ключ | Русский |
|---|---|
| `agentPanelLauncher` | «Агент» |
| `agentPanelOpen` | «Открыть агента» |
| `agentPanelClose` | «Закрыть панель агента» |
| `agentPanelLabel` | «Панель агента» |
| `agentPanelChats` | «Чаты» |
| `agentPanelBackToChat` | «К чату» |
| `agentPanelBusy` | «Агент отвечает» |

Скин Тандема: `TandemAgentPanelLauncher`, `TandemAgentPanel` в `skins/tandem/src/agent-panel.tsx`, экспорт в `tandemSkin`; галерея скина — панель открыта/закрыта, список поверх, светлая и тёмная тема.
