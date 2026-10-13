# Для авторов скинов: `ChatSkin` v18 и `MessengersSkin` v1

Скин — внешний вид чата: компоненты без логики. Слой поведения (`@ykurilov/agent-chat-react`) сам собирает ленту
из них. Что нового в 0.20.0:

- `ChatSkin` поднялся с версии 17 до **18**;
- появился отдельный договор `MessengersSkin` версии **1** (панель подключения мессенджеров).

**Скин версии 17 работает без правок.** Всё новое — необязательные поля.

## `ChatSkin` v18

Добавилось три необязательных компонента и один тип. Нет компонента — запасной вид.

| Компонент | Что рисует | Если нет у скина |
|---|---|---|
| `HelperCallRow` (`HelperCallView`) | Вызов помощника: задание, шаги, итог, подтверждение | Обычная строка инструмента |
| `TaskCard` (`TaskCardView`) | Карточка фоновой задачи с таймером и «Отменить» | Задачи в ленте не показываются |
| `AgentNoticeView` (`AgentNoticeViewProps`) | Служебное сообщение: итог задачи, вопрос подтверждения, «агент написал первым» | Короткая строка из `labels.notices.line` в `UserMessage`, без «Изменить»; указание агенту не показывается |

Пометка мессенджера: у элемента списка чатов (`ChatListItem`) появилось необязательное `origin?: ChatOriginView`
(`"telegram" | "vk" | "max"`). Скин списка может показать значок.

### `HelperCallView`

`name`, `title?`, `task` (задание), `steps` (шаги: `kind: "tool"` с `toolName`, `state`, `input`, `output`,
`errorText` или `kind: "text"`), `text` (итог или то, что уже написано), `status`
(`running | awaiting_approval | done | failed | background`), `approval?` (тот же `ToolApprovalView`, что у обычного
вызова), `approvalAction?` (что помощник хочет сделать), `errorText?`, `open` и `onOpenChange`.
Статус `background` — помощник ушёл в фон, итог придёт служебным сообщением.

### `TaskCardView`

`id`, `title`, `status` (`queued | running | awaiting_approval | done | failed | canceled | interrupted | timed_out`),
`elapsedMs` (готовую надпись о времени скин делает через `labels.tasks.elapsed`), `onCancel?` (есть, пока задачу
можно отменить), `canceling?` (отмена ушла, ответа нет — кнопку сделать занятой).

### `AgentNoticeViewProps`

`kind` (`task_done | task_failed | task_canceled | task_interrupted | task_timed_out | task_awaiting_approval |
conversation_started`), `title`, `result?`, `errorText?`, `approval?` (у `task_awaiting_approval` — кнопки решения).
`result` и `errorText` показывать только текстом, без разметки.

### Надписи

Новые надписи — в `labels` слоя поведения: `labels.tasks.*` (в том числе `elapsed`) и надписи служебных сообщений (`labels.notices.*`, в том числе `line` — строка итога для скина без `AgentNoticeView`).
Русский и английский наборы готовы; свой язык — дополнить тот же словарь.

## `MessengersSkin` v1

Панель «Подключить мессенджер». Поведение (запросы, обновление, ссылка с кодом) делает `useMessengerLinks`, скин только
рисует.

```ts
import type { MessengersSkin } from "@ykurilov/agent-chat-messengers/react";

const skin: MessengersSkin = {
  MessengerConnectPanel: ({ state, rows, onRetry }) => …,
};
```

`MessengerConnectPanelProps`:

- `state`: `loading | ready | failed` (при `failed` показать `labels.failed` и кнопку `onRetry`);
- `rows`: по строке на мессенджер — `messenger`, `connected` (`{ name, username? }` или `null`), `offer?`
  (`url`, `code`, `expiresAt` — готовая надпись «до 12:35»), `busy`, `failed`, `onConnect()`, `onDisconnect()`.

Надписи — `useMessengersLabels()`: русский `russianMessengersLabels`, английский `englishMessengersLabels`, свой набор —
`MessengersLabelsProvider`. Использование:

```tsx
<MessengerConnect url="/api/messengers" skin={skin} />
```

`url` — это `basePath` пакета без `/links` на конце. Пока у человека открыта ссылка с кодом, привязки перечитываются
каждые 3 секунды (`pollMs`), и строка сама становится «Подключено».
