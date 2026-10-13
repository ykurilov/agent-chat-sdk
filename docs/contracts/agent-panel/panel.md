# Договор: панель агента в слое поведения (021)

Вход пакета: `@ykurilov/agent-chat-react/panel` (новый `exports["./panel"]`). Основной вход `@ykurilov/agent-chat-react` его не импортирует.

## Подключение

```tsx
import { AgentPanel, AgentPanelProvider, useAgentPlace, useAgentDataChanges, useAgentPanel } from "@ykurilov/agent-chat-react/panel";

// Корневой макет, над маршрутами:
<AgentPanelProvider
  api="/api/chat"
  userKey={user.id}                 // запоминание на человека
  browserTools={{ open_task: async ({ taskId }, { signal }) => { navigate(`/tasks/${taskId}`); } }}
  mode="overlay"                    // или "push"
  width={420}
>
  <Routes />
  <AgentPanel skin={tandemSkin} /* + всё, что принимает AgentChat: voice, attachments, spendingLimits, liveness, voiceDialog */ />
</AgentPanelProvider>

// На странице карточки:
useAgentPlace({ description: `Карточка задачи «${task.title}», id ${task.id}`, data: { taskId: task.id } });

// В списке задач:
useAgentDataChanges("tasks", () => reloadTasks());
```

## `AgentPanelProvider`

| Свойство | Тип | По умолчанию |
|---|---|---|
| `api` | строка | — |
| `userKey` | строка | — (обязательно; смена — новое состояние) |
| `browserTools` | `Record<string, (input: any, ctx: { signal: AbortSignal }) => unknown \| Promise<unknown>>` | нет |
| `mode` | `"overlay" \| "push"` | `"overlay"` |
| `width` | число, px | 420 |
| `onDataChanged` | `(change: { id, tag, details? }) => void` | нет — для всех меток сразу |
| `fetch` | свой `fetch` | `globalThis.fetch` |

Создаёт `AgentAppBridge` (см. data-model.md) и состояние панели. Типы входа браузерных функций приложение может вывести из общего модуля описаний: `BrowserToolImplementations<typeof browserToolDescriptions>`.

## `AgentPanel`

Свойства: `skin: ChatSkin & ChatListSkin & AgentPanelSkin` и свойства `AgentChat` кроме `api`, `chatId`, `skin`, `onBusyChange`, `appBridge`. Рисует `skin.AgentPanelLauncher` и `skin.AgentPanel`; внутри — `AgentChat` открытого чата (смонтирован и при закрытой панели) и `skin.ChatList` поверх чата, когда открыт список.

## Хуки

```ts
useAgentPanel(): {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  /** Открыть панель на чате; чужой или удалённый — «Чат не найден» с переходом к списку. */
  openChat(chatId: string): void;
  /** Новый (или пустой) чат и готовый текст в поле ввода. false — не создался. */
  openNewChat(options?: { draft?: string }): Promise<boolean>;
  /** Отступ справа для страницы в режиме push; 0 — закрыто, overlay или экран ≤ 640 px. */
  pageInset: number;
  mode: "overlay" | "push";
  width: number;
  /** Идёт ответ в открытом чате — для значка на кнопке. */
  busy: boolean;
};

/** Место, пока компонент на экране. Главнее появившийся позже; вложенный всегда главнее внешнего (страница главнее макета) — и при первом показе, и после переходов. null или размонтирование снимает только это место. */
useAgentPlace(place: ScreenPlace | null): void;

/** Подписка на изменения данных по метке (или списку меток). Подписчик зовётся один раз на сообщение. */
useAgentDataChanges(tag: string | readonly string[], handler: (change: { id: string; tag: string; details?: unknown }) => void): void;
```

Вне `AgentPanelProvider` хуки бросают понятную ошибку («нужен AgentPanelProvider»).

## Изменения основного входа

```ts
// AgentChatProps, UseAgentChatOptions, ChatWorkspaceProps:
appBridge?: AgentAppBridge;      // место, вкладка, сообщения об изменениях, браузерные вызовы
// AgentChatProps, UseAgentChatOptions:
initialDraft?: string;           // текст в поле ввода при открытии чата
// UseChatListOptions:
rememberKey?: string;            // ключ запомненного чата; по умолчанию прежний `agent-chat:active-chat:${api}`
```

`useAgentChat` с мостом:

- в тела `messages`, `edit`, `retry`, `regenerate`, `approvals` добавляет `tabId` и `place` (из `currentPlace()` на момент запроса);
- `onData` у `useChat`: `data-app-change` → `bridge.dataChanged` (повтор `id` не раздаётся); `data-browser-call` с чужим `tabId` — пропуск; свой — `bridge.browserCall`, затем `POST {api}/{chatId}/browser-tools/{toolCallId}`; `toolCallId`, уже исполненный этой вкладкой (`sessionStorage`), — пропуск;
- отказ 409 `not_pending` на ответ вкладки — тихо (срок вышел или ответила другая копия вкладки).

Без моста — всё как до 021.

## Поведение панели

- Кнопка агента: открыть/закрыть (`aria-expanded`), значок «идёт ответ» по `busy`.
- Открытие: фокус в поле ввода (делает рамка скина); закрытие: фокус на кнопку агента.
- Esc (фокус внутри панели): открыт список чатов — закрывает список и возвращает к чату; следующий Esc закрывает панель. При открытом подтверждении удаления — ничего.
- Шапка: название открытого чата, «Чаты» (список поверх чата), «Закрыть».
- Список: выбор, «Новый чат», переименование, удаление — как в `ChatWorkspace`; после выбора или создания список закрывается.
- Занятость открытого чата сменилась — список тихо обновляется; пока у идущего чата нет названия — опрос раз в секунду (как `ChatWorkspace`, общий хук `useWorkspaceListSync`).
- Запоминание: `open` и открытый чат — на `api` + `userKey` (data-model.md).
