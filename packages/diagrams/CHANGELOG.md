# @ykurilov/agent-chat-diagrams

## 0.51.0

No changes in this release.

## 0.50.0

No changes in this release.

## 0.49.0

No changes in this release.

## 0.48.0

No changes in this release.

## 0.47.0

No changes in this release.

## 0.46.2

No changes in this release.

## 0.46.1

No changes in this release.

## 0.46.0

No changes in this release.

## 0.45.0

No changes in this release.

## 0.44.0

No changes in this release.

## 0.43.0

No changes in this release.

## 0.42.0

No changes in this release.

## 0.41.0

No changes in this release.

## 0.40.0

No changes in this release.

## 0.39.1

No changes in this release.

## 0.39.0

No changes in this release.

## 0.38.0

No changes in this release.

## 0.37.0

No changes in this release.

## 0.36.0

No changes in this release.

## 0.35.0

No changes in this release.

## 0.34.0

No changes in this release.

## 0.33.0

No changes in this release.

## 0.32.0

No changes in this release.

## 0.31.2

No changes in this release.

## 0.31.1

No changes in this release.

## 0.31.0

No changes in this release.

## 0.30.0

No changes in this release.

## 0.29.0

No changes in this release.

## 0.28.0

No changes in this release.

## 0.27.0

No changes in this release.

## 0.26.2

No changes in this release.

## 0.26.1

No changes in this release.

## 0.26.0

No changes in this release.

## 0.25.0

No changes in this release.

## 0.24.0

No changes in this release.

## 0.23.0

No changes in this release.

## 0.22.0

No changes in this release.

## 0.21.0

No changes in this release.

## 0.20.0

No changes in this release.

## 0.19.0

No changes in this release.

## 0.18.6

No changes in this release.

## 0.18.5

No changes in this release.

## 0.18.4

No changes in this release.

## 0.18.3

No changes in this release.

## 0.18.2

No changes in this release.

## 0.18.1

No changes in this release.

## 0.18.0

No changes in this release.

## 0.17.0

No changes in this release.

## 0.16.0

### Minor Changes

- cf52f10: **Ломает только исчерпывающие проверки:** у `UsageSource` появилось значение `images`, у видов ошибок сервера — `widget_not_pending` и `invalid_answer`, у `ChatService` — метод `answerWidget`. Своё хранилище должно поддержать условную запись `AwaitingMessagePatch.expectedParts` (при несовпадении частей — `MessageNotAwaitingError`; помощник `sameMessageParts` из core), иначе две копии сервера могут затереть ответы друг друга; общие тесты хранилищ это проверяют. Остальное необязательно, приложение без правок работает как раньше.
  
  Что нового: агент может спросить кнопками, звёздами или формой (виджеты), нарисовать схему блоком ` ```mermaid ` и создать картинки через Runware. Всё включается отдельно:
  
  - виджеты: `agent: { widgets: { basic: true, custom: [свойВиджет] } }`, свой виджет — `defineWidget` из core и компонент в `widgets={{ … }}` у `AgentChat`; ответ человека идёт на `POST /:chatId/widgets/:toolCallId`, ход ждёт со статусом `awaiting_approval`;
  - схемы: новый пакет `@ykurilov/agent-chat-diagrams`, `agent: { diagrams: true }` на сервере и `diagrams={diagramsClient}` на странице;
  - картинки: новый пакет `@ykurilov/agent-chat-images` (нужен пакет вложений и `RUNWARE_API_KEY`), `images.tools(model)` в `agent.tools`, `images={imagesClient}` на странице; свой срок ожидания (210 с) инструмент сообщает ядру сам (`declareToolTimeout`), расход бронируется до заказа (`assertWithinLimit({ pendingUsd })`);
  - окно просмотра картинок и схем: Тандем готов, своему скину — необязательные части договора версии 13 (`Widget`, `SuggestedReplies`, `GeneratedImages`, `MediaViewer`, `diagramColors`, `renderDiagram`). `splitMermaidBlocks` экспортируется из react;
  - вложения: `Attachments.storage` и `detectFileKind` экспортируются из пакета вложений;
  - голосовой режим произносит вопрос и варианты ждущего виджета и говорит «схема на экране» вместо блока схемы;
  - «Стоп» на экране закрывает висящие вызовы так же, как сервер, разрешённые без результата — «результат неизвестен» (`stoppedToolCallReasons.resultUnknown`);
  - упавший свой виджет страницы заменяется запасным видом скина, лента цела.
  
  Подробно: `docs/widgets.md`, `docs/diagrams.md`, `docs/images.md`, `docs/media-viewer.md`.
  
  ### Как обновить приложение
  
  Обычному приложению на SQLite или PostgreSQL из набора делать ничего не нужно: миграций нет, всё новое включается отдельно.
  
  1. Исчерпывающий `switch` по `UsageSource` — добавьте ветку `"images"`; по видам ошибок сервера — `"widget_not_pending"` и `"invalid_answer"`.
  2. Своя реализация `ChatService` — добавьте метод `answerWidget({ chatId, ownerId, toolCallId, answer, page }): Promise<{ resumed: boolean }>` (тип `WidgetAnswerRequest` из core, образец — служба из core).
  3. Своё хранилище: `updateAwaitingMessage` получает необязательное поле `expectedParts`. Если оно есть и части сообщения в базе с ним не совпадают (`sameMessageParts` из core), бросайте `MessageNotAwaitingError`; проверку и запись делайте в одной транзакции. Прогоните общие тесты хранилищ из core.
  4. Своя обёртка `assertWithinLimit` из limits — пробрасывайте новое необязательное поле `pendingUsd`.
  5. Проверка: `pnpm typecheck`, затем в чате отправить сообщение и получить ответ.
