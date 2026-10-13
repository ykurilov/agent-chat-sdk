# Договор: список чатов (010)

## HTTP (обработчик чата, только при `chatList: true`)

Все адреса — под `basePath` обработчика чата, например `/api/chat`. Пользователь — из `resolveUser`: нет — `401 {"error":{"kind":"invalid"}}`.
Чужой чат и несуществующий неотличимы: `404 {"error":{"kind":"not_found"}}`.

| Метод и адрес | Тело | Успех | Ошибки |
|---|---|---|---|
| `GET {basePath}` | — | `200 {"chats":[{"id","title","createdAt","updatedAt"}]}` — чаты пользователя, самые недавние первыми; `title` — строка или `null` | 401 |
| `PATCH {basePath}/{chatId}` | `{"title":"…"}` | `200 {"id","title"}` — название, как записано (пробелы по краям срезаны, переносы и повторные пробелы схлопнуты) | 400 `invalid` (тело не объект, `title` не строка, пустое, длиннее 100 знаков), 401, 404. Занятость не проверяется: `409` тут не бывает, переименовать можно и во время ответа |
| `DELETE {basePath}/{chatId}` | — | `204` без тела | 401, 404 (в том числе повторное удаление), 409 `busy` — только если чат уже удаляется или в этот миг запускается ход (сообщение, «переделать», правка). Идущий ответ 409 не даёт: удаление его останавливает |

- `POST {basePath}` (создание чата) и остальные адреса чата не меняются.
- Без `chatList` адреса `GET {basePath}`, `PATCH`, `DELETE` — `404 not_found`, как до возможности.
- Путь `models` (`GET {basePath}/models`) по-прежнему меню моделей: идентификаторы чатов — UUID.

## Ядро (`ChatService`)

- `listChats(userId): Promise<ChatListItem[]>`, `ChatListItem = { id, title: string | null, createdAt, updatedAt }`.
- `renameChat(userId, chatId, title): Promise<string>` — `ChatNotFoundError`, `InvalidChatTitleError`. `ChatBusyError` не бросает.
- `deleteChat(userId, chatId): Promise<void>` — `ChatNotFoundError`, `ChatBusyError` (чат уже удаляется или ход как раз запускается). Порядок: занять чат → остановить идущий ответ и дождаться его конца → отменить сжатие и дождаться → `attachments.removeChatFiles` (файлы первыми: не удалились — чат цел, удаление можно повторить) → `storage.deleteChat` → отпустить.
- Пока чат удаляется, `ChatBusyError` (409) получают: новое сообщение, «повторить», «переделать», правка, `compactNow` и любой адрес вложений (загрузка и чтение; через `assertOwnChat`).
- `sendMessage`: если у чата нет названия — `renameChat` в хранилище названием `deriveChatTitle(text)` до начала ответа.
- `deriveChatTitle(text)`: схлопнуть пробельные символы в один пробел, срезать по краям; длиннее 60 знаков — первые 60 (без хвостового пробела) и «…». Пустое — `null`.

## Хранилище (`ChatStorage`)

- `Chat.title?: string` (нет — без названия).
- `listChats(ownerId): Promise<Chat[]>` — по убыванию `updatedAt`, затем `createdAt`, затем `id`.
- `renameChat(chatId, title: string | null): Promise<void>` — `updatedAt` не трогает; неизвестный чат — тихо.
- `deleteChat(chatId): Promise<void>` — в одной транзакции сообщения, записи сжатия, чат. Неизвестный чат — тихо. Выбор веток (`branch_selections`, 007) уходит там же. Файлы вложений лежат вне хранилища чата и уходят раньше — через `attachments.removeChatFiles`.

## Слой поведения (`@ykurilov/agent-chat-react`)

```ts
<ChatWorkspace api="/api/chat" skin={tandemSkin} initialChatId? onChatChange? liveness? voice? />
useChatList({ api, fetch?, initialChatId? }): ChatListState
AgentChat: + onBusyChange?: (busy: boolean) => void
```

`ChatListState`: `status: "loading" | "ready" | "error"`, `items` (`{ id, title: string | null, createdAt, updatedAt }`), `activeChatId | null`, `select(id)`, `create(): Promise<boolean>` (открывает уже существующий пустой чат — без названия и без сообщений, — иначе создаёт), `creating`, `rename(id, title)` (пустое и прежнее название не отправляет), `deleteRequest: { id, title: string | null } | null`, `requestDelete(id)`, `confirmDelete()`, `cancelDelete()`, `deleting`, `error: "create" | "rename" | "delete" | null`, `refresh()` (тихое обновление), `reload()` (загрузка заново после отказа).

## Договор скина, версия 7 (отдельный интерфейс `ChatListSkin`, `ChatSkin` не меняется)

```ts
interface ChatListItemView { id: string; title: string | null; active: boolean }   // null → скин пишет labels.chatListUntitled, поле переименования пустое

interface ChatListSkin {
  ChatWorkspace: ComponentType<{
    /** Панель списка (рисует ChatList). */
    list: ReactNode;
    /** Открытый чат. */
    children: ReactNode;
    /** Название открытого чата для полосы телефона, уже готовой надписью (у безымянного — «Новый чат»). */
    activeTitle: string;
    /** Панель выдвинута (только узкий экран). */
    listOpen: boolean;
    onListOpenChange: (open: boolean) => void;
  }>;
  ChatList: ComponentType<{
    status: "loading" | "ready" | "error";
    items: ChatListItemView[];
    onSelect: (chatId: string) => void;
    onCreate: () => void;
    creating: boolean;
    /** Скин сам ведёт поле названия; зовёт только с непустым изменённым названием. Слой поведения отбрасывает пустое и прежнее и сам. */
    onRename: (chatId: string, title: string) => void;
    /** Скин не удаляет сам: «Удалить» лишь просит подтверждение. */
    onRequestDelete: (chatId: string) => void;
    /** Есть — показать окно подтверждения; нет — окна нет. */
    deleteRequest?: { title: string; pending: boolean; onConfirm: () => void; onCancel: () => void };
    /** Готовая надпись об ошибке (действие не удалось или список не загрузился). */
    error?: string;
    /** Есть — рядом с ошибкой кнопка «Повторить». */
    onRetry?: () => void;
  }>;
}
```

Escape в поле переименования отменяет только правку: панель телефона от него не закрывается. После Enter и Escape фокус возвращается на кнопку строки.

Надписи (`ChatLabels`, 16 новых обязательных ключей): `chatListHeading` («Чаты»), `chatListNewChat` («Новый чат»), `chatListUntitled` («Новый чат»), `chatListLoading`, `chatListLoadFailed`, `chatListCreateFailed`, `chatListRenameFailed`, `chatListDeleteFailed`, `chatListRowMenu(title)` («Действия с чатом …»), `chatListRename` («Переименовать»), `chatListRenameField` («Название чата»), `chatListDelete` («Удалить»), `chatListDeleteTitle` («Удалить чат?»), `chatListDeleteBody(title)`, `chatListDeleteConfirm` («Удалить»), `chatListDeleteCancel` («Отмена»).
