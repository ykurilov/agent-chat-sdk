# @ykurilov/agent-chat-sandbox

Песочница агента для админа приложения: чат с боевым агентом, журнал каждого обращения к модели и вызова инструмента,
правка любого сообщения с веткой, своя модель и своя системная инструкция на чат. Отдельное расширение: приложению без
песочницы пакет не нужен, и в боевом чате ничего не меняется (ни таблиц, ни записи журнала).

`react`, `@ykurilov/agent-chat-react`, `better-sqlite3` и `pg` — необязательные зависимости (peer): ставьте те, что нужны.

## Сервер

```ts
import { createSandboxHandler } from "@ykurilov/agent-chat-sandbox";
import { createSqliteSandboxJournal } from "@ykurilov/agent-chat-sandbox/sqlite"; // или …/postgres
import { mountChat } from "@ykurilov/agent-chat-server/hono";

mountChat(app, createChatHandler(chatOptions));
mountChat(app, createSandboxHandler({
  chat: chatOptions, // те же настройки, что у боевого чата
  isAdmin: (user) => adminIds.has(user.id), // на каждом запросе; не админ получает 404
  journal: await createSqliteSandboxJournal({ filePath: "app.sqlite" }),
}));
```

Next.js: `createNextRouteHandlers(sandboxHandler)` в `app/api/sandbox/[[...path]]/route.ts`.

## Экран

```tsx
import { AgentSandbox } from "@ykurilov/agent-chat-sandbox/react";
import { tandemSandboxSkin } from "@ykurilov/agent-chat-skin-tandem/sandbox";

<AgentSandbox skin={tandemSkin} sandboxSkin={tandemSandboxSkin} chatListSkin={tandemSkin} chatProps={{ attachments, images, videos }} />
```

## Что важно знать

- **Доступ.** `resolveUser` → `isAdmin` на каждом запросе, результат не кэшируется. Песочные чаты личные: владелец
  `sandbox:<id админа>`, боевые адреса, списки и траты их не видят. `isSandboxOwner(ownerId)` отделяет их в отчётах о тратах.
- **Журнал.** Таблицы `sandbox_*` в SQLite или PostgreSQL (`createMemorySandboxJournal` для тестов), миграции сами. Живёт 30 дней
  (`retentionDays`), удаляется вместе с чатом. Запись не задерживает ответ; ключи из окружения (по именам KEY, TOKEN, SECRET… от 8 знаков), пароли из адресов подключения и заголовки не пишутся.
- **Память только на чтение.** Агент видит боевую память админа, записать ничего не может; экран памяти в песочнице закрыт.
- **Правка ответа.** Меняются текст и результаты обычных инструментов; вызовы, картинки, видео и ответы на виджеты остаются,
  рассуждения убираются. `chat.lockedToolOutputs` добавляет инструменты, чей результат менять нельзя.
- **Инструменты.** В `agent.tools(model)` приходит настоящий `ownerId` админа. Инструментам из `chatOwnedTools` (по умолчанию
  `generate_images`) — песочный владелец: файлы и траты принадлежат песочному чату.
- **Закрытый чат.** Инструмент закрывает песочный чат так же, как боевой: видно, что закрытие работает. Продолжить тест —
  кнопка «Открыть чат снова» (`POST {sandboxBase}/chats/:chatId/reopen`) или новая копия чата человека: она всегда открыта.
  Права приложения (`chatCapabilities`) и `beforeCreateChat` песочница не применяет.
- **Осторожно.** Инструменты приложения в песочнице выполняются по-настоящему от имени админа (письма, платежи, запись в базу). Опасные подмените заглушками: см. docs/sandbox.md, «Инструменты агента».
- **Чаты людей.** Только с опцией `people` у обработчика и `people` у `AgentSandbox`: `people: { find }` — человека ищет
  приложение, `people: true` — его id вводят вручную. Без опции раздела нет, экран прежний. Чат человека только читается;
  «Проверить в копии» делает песочный чат админа, агент в нём читает память человека. В копии `agent.tools(model)` получает
  `ownerId` человека, `model.staff` и объект исходного чата (`model.subject`, ключ копии наружу не идёт): при
  `model.staff` любая запись в данные `ownerId` запрещена — это обязанность инструментов приложения, ядро их записи
  не перехватывает. `afterTurn` приложения зовётся только в копии, так же с `staff`, человеком и его объектом: при
  `turn.staff` в данные человека не писать. В обычном песочном чате `afterTurn` и `beforeTurn` не зовутся.
- **Лимиты.** Картинки считаются на песочного владельца по правилам приложения; у модели лимит только если задан
  `createSandboxHandler({ limits })`.

Подробно — [docs/sandbox.md](../../docs/sandbox.md). Живая проверка: `pnpm test:live sandbox`.
