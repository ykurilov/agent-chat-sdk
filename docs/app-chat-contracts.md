# Контракты чата для приложения

Контракты чата этой страницы доступны с SDK 0.79.0. `importChat.chat.data` и тестовая модель AI SDK доступны уже в 0.77.0. Приложение обновляет все установленные `@ykurilov/agent-chat-*` одной версией.

## Агент пишет первым в чате из браузера

`newChatGreeting` у `createChatServer` / `createChatHandler` относится к `POST {basePath}`, включая кнопку «Новый чат» в `ChatWorkspace`. Решение принимает сервер после `newChatData`; содержимое HTTP body не задаёт приветствие.

```ts
const { handler, service } = createChatServer({
  // storage, catalog, defaultChoice, resolveUser, agent и basePath — как прежде
  ...chatOptions,
  newChatData: async ({ user }) => ({ mode: await modeForUser(user.id) }),
  newChatGreeting: async ({ userId, chatData }) => {
    if (chatData?.mode === "interview") {
      return { instruction: "Поздоровайся и задай первый вопрос анкеты." };
    }
    return { instruction: await greetingInstruction(userId, chatData?.mode) };
  },
});
```

Результат — прежний `ChatGreeting`: `{ instruction: string }`, `{ text: string }` или `null` (не приветствовать). Асинхронная функция ожидается до создания; исключение или неверный результат не оставляют чат. Данные передаются копией. Указание запускает обычный ход с правами, лимитами и расходом; текст сохраняется готовым сообщением без модели. В обоих случаях срабатывает только создание: чтение истории, перезагрузка и подключение к потоку не запускают приветствие заново.

Гарантия — одна попытка побудки **на созданный чат**. Сам `POST` не идемпотентен: повтор запроса создаст другой чат. Сбой модели, лимит или отказ хука могут помешать ответу; созданный чат сохраняется, ошибка видна обычным путём. Автоматической повторной побудки по GET нет. После начала хода поток и восстановление работают как у остальных ответов.

Серверное `service.createChat(userId, { greeting, data, title })` и `openSubjectChat({ ..., greeting })` сохраняют свои явные настройки. `newChatGreeting` не применяется к ним, к импорту и к найденному объектному чату. Тестовый чат приложения может вернуть `null` по своим серверным данным; настройка не включает рассылку существующим пользователям.

## Текущий вопрос и асинхронная классификация

`agent.contextBlocks` получает `userMessage: { id, text } | null`. Это текстовые части сохранённого вопроса человека, без извлечённого текста вложений, служебных событий и блоков контекста. В типе поле необязательно для совместимости собственных вызовов функции; ядро передаёт его всегда. Для хода по служебному событию и первого сообщения агента значение `null`. Пачки/поправки не превращают служебный текст в человеческий: передаётся последний фактический вопрос в истории данного ответа.

```ts
agent: {
  instructions,
  contextBlocksTimeoutMs: 2_000,
  contextBlocks: async ({ userMessage, ownerId, chatId, abortSignal }) => {
    if (!userMessage) return [];
    const hint = await checkRequestedMode(userMessage.text, { abortSignal });
    return hint ? [{ key: "mode_hint", text: hint }] : [];
  },
}
```

Источник ожидается до первого запроса модели. Временный `Map` между `beforeTurn` и `contextBlocks` не требуется: идентификаторы владельца, чата, ответа и вопроса переданы самому вызову. Данные и результат не смешиваются между параллельными чатами. Инструменты и повтор провайдера используют уже застывшие блоки. Продолжение с сохранёнными завершёнными шагами использует сохранённый контекст, не выполняя классификацию заново. Retry без завершённых шагов создаёт новый ответ и может заново вызвать источник. При возобновлении после approval/widget источник обновлений может быть вызван снова с исходным вопросом; само подтверждение не объявляется новым человеческим сообщением. Поправка человека начинает контекст для её фактического сообщения.

В новом режиме `contextBlocksRefresh: "history-start"` блоки приложения застывают до смены начала видимой истории, как память. Он готовится к следующему minor после 0.79.0; для классификации каждого вопроса сохраните прежний `"turn"`. [Правила снимка и notices](context-blocks-refresh.md).

По умолчанию срок источника 5 секунд. Исключение или превышение срока сохраняет прежнее поведение: берутся блоки прошлого ответа, ошибка журналируется. Для критической проверки доступа используйте серверные права/хуки; подсказка модели не является запретом. Если классификация не дала подсказку, верните `[]`, чтобы убрать прежний `mode_hint`.

## Данные и название при создании и импорте

```ts
await service.createChat(userId, {
  title: "Личный дневник",
  data: { mode: "companion" },
  greeting: { instruction: "Начни разговор." },
});
await service.importChat({
  ownerId: userId,
  chat: { title: "Перенесённый разговор", data: { mode: "interview" } },
  messages,
});
```

`title` нормализуется теми же правилами, что при переименовании: пробелы схлопываются, нулевой символ удаляется, от 1 до 100 Unicode-знаков. Неверное название отклоняется до создания. Явное название не заменяется первым вопросом. Без него сохраняется прежнее автозаглавие.

`data` — JSON-объект до 16 КБ, только для серверных хуков/инструментов; не включается автоматически ни в system prompt, ни в историю браузера. У импорта поле `chat.data` уже есть в 0.77.0, прежнее `subjectData` остаётся совместимым именем. Название — метаданные списка; инструкции модели приложение задаёт через `agent.instructions` / `chatInstructions`.

## Устойчивые номера фотографий

```ts
const attachments = createAttachments({ storage: attachmentStorage, imageNumbers: true });
// Передайте attachments в createChatServer / createChatService, как прежде.
const photos = await service.getChatImages(userId, chatId);
const chosen = photos.find(photo => photo.number === requestedPhotoNumber);
if (!chosen) throw new Error("Такого фото нет в текущей ветке чата");
const image = await attachments.readChatImage({ chatId, attachmentId: chosen.attachmentId });
```

Функция включается явно; без `imageNumbers` запросы модели прежние. Нумеруются только новые принятые картинки человека. Сервер записывает метку вместе с файлом в том же сообщении; клиентские метки игнорируются. Модель видит `[Фото №3]` непосредственно перед соответствующей картинкой или её плашкой. Интерфейс не меняется. PDF, текст, картинки агента и скриншоты инструментов номера не получают.

Счётчик общий для `chatId`, начиная с 1. Тот же `attachmentId` сохраняет номер при повторной отправке. Перезапуск, повтор ответа и компакция номера не меняют. Новые картинки получают номера выше всех сохранённых, включая скрытые ветки: после возврата с ветки могут остаться пропуски, номера не переиспользуются. Чтение `getChatImages` не пишет данные и возвращает `{ number, attachmentId, messageId }` только для нумерованных картинок полной активной ветки, даже если её начало сжато. Владелец проверяется службой; приложение берёт `userId/chatId` из доверенного серверного контекста, а не из аргументов модели. Перед сохранением выбора проверяйте наличие всех запрошенных номеров и результат `readChatImage`: файл мог стать недоступен.

Старые файлы без серверной метки не нумеруются задним числом и не появляются в этом списке. Их явная повторная отправка после включения получает номер. Импорт создаёт новую нумерацию человеческих картинок по порядку импортируемых сообщений и частей; номера из внешнего JSON не принимаются. Удаление чата удаляет его сообщения и метки, новый чат начинает с 1. SQL-схемы не меняются. Нескольким процессам по-прежнему нужно хранилище с распределённой арендой `claimChatTurn/releaseChatTurn`. Просмотр всех сохранённых веток для назначения номера выполняется один раз на принимаемое сообщение с картинками, не на каждый токен или повтор модели.

## Direct DeepSeek и OpenRouter

На 24.10.2026 официальный [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) и [руководство thinking](https://api-docs.deepseek.com/guides/thinking_mode/) используют `thinking: { type: "enabled" | "disabled" }` отдельно от `reasoning_effort: "low" | "high" | "max"`. `none` в Responses/Anthropic-протоколе и выключение Chat Completions не следует считать одной строкой, которую любой адаптер пропустит. Закреплённый `@ai-sdk/deepseek` передаёт camelCase `providerOptions.deepseek.reasoningEffort` как `reasoning_effort`.

Статическое `high`, уже работающее в 0.77.0:

```ts
const base = standardCatalog.models.find(model => model.id === "deepseek-4.1-flash")!;
const catalog = extendCatalog(standardCatalog, {
  addModels: [{ ...base, providerOptions: {
    ...base.providerOptions,
    deepseek: { ...base.providerOptions?.deepseek, reasoningEffort: "high" },
  } }],
});
// defaultChoice: { modelId: base.id, providerId: "deepseek", reasoning: "on" }
```

Для переключения силы используйте профиль приложения с `reasoning.levels: ["off", "low", "high", "max"]` и `defaultLevel: "high"`; серверный `ModelChoice.reasoning` выбирает уровень. Ядро отправляет для `off` только отключение thinking, для остальных — включение и соответствующий direct effort. Старые `off/on` стандартного профиля сохраняют прежние байты. SDK-алиасы `minimal` и `medium` преобразуются в direct `low` и `high` по официальной таблице; нового произвольного диапазона значений нет.

OpenRouter имеет отдельное поле `providerOptions.openrouter.reasoning`, а SDK-уровень `max` у него передаётся как `xhigh`; direct DeepSeek получает именно `max`. Не переносите body direct-провайдера на OpenRouter и обратно. Если расширяете общий профиль с несколькими провайдерами, проверяйте поддержку уровней каждым маршрутом; отдельный direct-only каталог строится через `removeProviders`. Live-проверка доступности/семантики модели остаётся задачей приложения: unit wire-тесты проверяют сериализацию без платных запросов.

## Модель для тестов приложения без сети

Новый `core/testing` не требуется. AI SDK, от которого зависит core, предоставляет `MockLanguageModelV4` в `ai/test`. Приложение явно закрепляет совместимую версию `ai` (для этой базы — 7.0.122); мок импортируется только тестами.

```ts
import { MockLanguageModelV4 } from "ai/test";
import { extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";

const model = new MockLanguageModelV4({ doStream: async () => ({
  stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "stream-start", warnings: [] });
    controller.enqueue({ type: "text-start", id: "text-1" });
    controller.enqueue({ type: "text-delta", id: "text-1", delta: "Тестовый ответ" });
    controller.enqueue({ type: "text-end", id: "text-1" });
    controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    } });
    controller.close();
  } }),
}) });
const catalog = extendCatalog(standardCatalog, {
  addProviders: [{ id: "test", displayName: "Test", apiKeyEnv: "TEST_MODEL_TOKEN",
    createLanguageModel: () => model, requestOptions: () => ({}) }],
  addModels: [{ id: "test-model", displayName: "Test", contextWindowTokens: 100_000,
    acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { test: "test-model" } }],
});
// В тестовой службе: catalog, defaultChoice: { modelId: "test-model", providerId: "test" },
// env: { TEST_MODEL_TOKEN: "unused-test-value" }. Сетевых ключей не требуется.
// model.doStreamCalls содержит реальные запросы службы для содержательных assertions.
```

Для инструментов, ошибок, approval и компакции тест задаёт соответствующие stream-части и `doGenerate` для сводки. Мок проверяет интеграцию приложения, а не качество LLM или доступность DeepSeek. Он не подключается к production-каталогу автоматически и не добавляет Vitest в production.

## Блоки после компакции

`contextBlocks` не являются частью текста, который ядро сокращает при компакции. Каждый ответ хранит полный принятый набор. Пока базовый ответ виден, модель получает разницу; если компакция убрала базу, первый оставшийся набор передаётся полностью в исходном порядке, без обрезания текстов и без повторения одинаковых блоков в каждом ходе. Следующий вопрос продолжает тот же prefix. Вложения сохраняют свои серверные метки вместе с сообщениями; сжатая сводка не используется для восстановления номера другого файла.

Это относится к корректным принятым блокам: уникальный незарезервированный ключ, непустой текст. `hidden: true` явно скрывает текст; `private` не отправляется группе. Ошибка/timeout источника имеет описанный выше fallback, а реальный предел контекста провайдера не становится бесконечным: ядро не обещает уместить произвольный объём блоков, оно не урезает их молча.
