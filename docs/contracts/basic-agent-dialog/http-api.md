# Contract: HTTP-адреса серверного обработчика

Пакет `@ykurilov/agent-chat-server`. Обработчик работает на стандартных `Request`/`Response`.

## Создание обработчика

```ts
createChatHandler({
  basePath: "/api/chat",
  storage: ChatStorage,                                   // contracts/storage.md
  resolveUser: (request: Request) => Promise<{ id: string } | null>,
  resolveModel: (ctx: { userId: string; chatId: string }) =>
    Promise<{ modelId: string; providerId: string }>,     // FR-022a
  catalog: ModelCatalog,                                  // contracts/model-profile.md
  agent: {
    instructions: string,                                 // постоянная, без времени (FR-023)
    tools?: ToolSet,                                      // инструменты AI SDK (FR-009)
    maxSteps?: number,                                    // по умолчанию 20
  },
  env?: Record<string, string | undefined>,               // ключи провайдеров; по умолчанию process.env
  logError?: (message: string) => void,                   // журнал сервера; по умолчанию console.error
}) → { fetch(request: Request): Promise<Response>; recoverInterruptedAnswers(): Promise<number> }
```

Переходник Hono: `import { mountChat } from "@ykurilov/agent-chat-server/hono"` →
`mountChat(app, handler)`. Заголовки и cookie, выставленные промежуточными обработчиками
приложения до `next()`, добавляются к ответу чата (Hono иначе теряет их у готового `Response`).

## Общие правила

- `resolveUser` вернул `null` → `401`. Чат есть, но чужой → `404` (не `403`: существование
  чужого чата не раскрывается) (FR-024, US5-2).
- Тело ошибки: `{ "error": { "kind": ChatErrorKind | "not_found" | "busy" | "invalid" } }`.
  Сырых текстов провайдера нет.
- Нет ключа провайдера в окружении — ход открывается как обычно (`200`, первый кусок `start`),
  ответ получает ошибку `invalid_key`. В журнал сервера (`logError`) пишется провайдер и имя
  переменной окружения, значений нет.
- Непредвиденный сбой — `500 other`, подробность только в журнале сервера.
- Потоки — формат SSE UI-сообщений AI SDK (`UI_MESSAGE_STREAM_HEADERS`).

## Адреса

| Метод и путь | Что делает | Ответ |
|---|---|---|
| `POST {base}` | Создать чат | `201 { id }` |
| `GET {base}/:chatId` | История текущей ветки без идущего ответа | `200 { chat, messages: UIMessage[], running: boolean }` |
| `POST {base}/:chatId/messages` | Новая реплика и запуск хода | `200` SSE-поток ответа; `409 busy` если ход уже идёт |
| `POST {base}/:chatId/retry` | Повторить последний ответ | `200` SSE-поток; `409 busy`; `409 invalid`, если повторять нечего |
| `GET {base}/:chatId/stream` | Подключиться к идущему ответу | `200` SSE с начала хода; `204`, если хода нет |
| `POST {base}/:chatId/stop` | Остановить идущий ответ | `202`; `204`, если хода нет |

### `POST {base}/:chatId/messages`

Запрос — формат `DefaultChatTransport` SDK с нашим `prepareSendMessagesRequest`: клиент
отправляет только новое сообщение, не всю историю.

```json
{ "message": { "id": "…", "role": "user", "parts": [{ "type": "text", "text": "…" }] } }
```

Сервер: проверяет владельца и текст → сохраняет сообщение с `parentId` = конец текущей
ветки → собирает историю из хранилища → запускает ход в реестре → отдаёт поток подписки.
Обрыв соединения только отписывает слушателя, ход идёт дальше (FR-012).

Повтор того же `message.id` (двойное нажатие) не создаёт второе сообщение:
- ход по нему ещё идёт → `409 busy`, клиент подключается к ходу через `GET …/stream`;
- ход уже закончен → `409 invalid`.

### `POST {base}/:chatId/retry`

Тело пустое. Берёт последнее сообщение собеседника текущей ветки и запускает новый ход с ним
как родителем (FR-017). Доступно, только если последний ответ в состоянии `error`,
`stopped` или `interrupted`, либо пустой (без текста). Ещё доступно, если ветка кончается
вопросом без ответа. Иначе — `409 invalid`.

Новый ответ сохраняется соседом прежнего с тем же родителем; прежний не удаляется. Время
создания нового ответа строго позже прежнего, поэтому текущей веткой становится новый.

### Поток ответа

Первый кусок — `start` с `messageId` и `metadata` (`modelId`, `providerId`). Дальше куски
SDK: `reasoning-*`, `text-*`, `tool-*`, `start-step`, `finish-step`. Перед `finish` —
`message-metadata` с `usage`, `reasoningDurationsMs`, `status`. При ошибке — сначала
`message-metadata` с `status: "error"` и `error.kind`, затем кусок `error` с текстом-кодом
`ChatErrorKind`, затем `finish`. Итог идёт раньше `error`: на куске `error` клиент SDK
перестаёт читать поток и итог после него не увидел бы.
