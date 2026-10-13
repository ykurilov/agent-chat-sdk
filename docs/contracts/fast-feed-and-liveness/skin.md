# Contract: договор скина, версия 2

Заменяет [договор 001](../basic-agent-dialog/skin.md). Объявлен в
`@ykurilov/agent-chat-react` 0.2.0 (`skin-contract.ts`). Изменение несовместимое: по
принципу II это смена «старшей» версии пакета поведения (для 0.x — 0.1 → 0.2, research R15),
скин Тандема обновляется в той же фиче.

## Что изменилось против версии 1

| Компонент | Было | Стало | Зачем |
|---|---|---|---|
| `Layout` | `feed`, `composer`, `notice?`; прилипание к низу — внутри скина | + `scrollRef` (обязателен), + `announcement`; прилипания в скине больше нет | Окно ленты и правило прокрутки живут в поведении (FR-001, FR-004, FR-008); диктор (FR-009) |
| `Reasoning` | `defaultOpen: false`, раскрытие — `useState` скина | `open`, `onOpenChange`; `defaultOpen` удалён | Раскрытое не теряется, когда сообщение ушло за край экрана (FR-006) |
| `ToolCallRow` | раскрытие — `useState` скина | + `open`, `onOpenChange` | То же (FR-006) |
| `ConnectionNotice` | — | новый | «Переподключаемся…» и «Нет связи с сервером» (FR-013, FR-013a) |

Остальные компоненты (`UserMessage`, `AgentMessage`, `AgentText`, `ErrorNotice`,
`ChatNotFound`, `Composer`) не меняются.

```ts
interface ChatSkin {
  Layout: ComponentType<{
    feed: ReactNode
    composer: ReactNode
    notice?: ReactNode
    /** Повесить на элемент, который прокручивается; `feed` положить внутрь него. */
    scrollRef: RefObject<HTMLDivElement | null>
    /** Текст для диктора: положить в визуально скрытый элемент с aria-live="polite". */
    announcement: string
  }>
  UserMessage: ComponentType<{ text: string }>
  AgentMessage: ComponentType<{ /* как в версии 1 */ }>
  AgentText: ComponentType<{ markdown: string; streaming: boolean }>
  Reasoning: ComponentType<{
    text: string
    streaming: boolean
    durationMs: number | null      // null, пока идёт
    open: boolean
    onOpenChange: (open: boolean) => void
  }>
  ToolCallRow: ComponentType<{
    toolName: string
    state: "running" | "done" | "error"
    input?: unknown
    output?: unknown
    errorText?: string
    open: boolean
    onOpenChange: (open: boolean) => void
  }>
  ErrorNotice: ComponentType<{ kind: ChatErrorKind; onRetry?: () => void }>
  /** Состояние связи над полем ввода; кнопка «Повторить» — только у "offline". */
  ConnectionNotice: ComponentType<{ state: "reconnecting" | "offline"; onRetry?: () => void }>
  ChatNotFound: ComponentType
  Composer: ComponentType<{ /* как в версии 1 */ }>
}
```

## Правила для скина

- **Скроллер**. `Layout` вешает `scrollRef` на свой прокручиваемый элемент
  (`overflow-y: auto`) и кладёт `feed` внутрь. Отступы вокруг ленты допустимы: поведение
  само мерит, где лента начинается. Скин не прокручивает ленту сам и не следит за низом:
  это делает поведение (порог «у низа» — 96 px).
- **Контейнер ленты**. Элемент вокруг `feed` — `role="log"` с `aria-live="off"`: окно ленты
  монтирует старые сообщения при прокрутке, и живая область зачитывала бы их заново.
  Новые сообщения диктор слышит через `announcement`.
- **Промежутки между сообщениями**. Лента — это список с абсолютным положением элементов:
  `gap` у контейнера не работает. Промежуток задаёт внутренний отступ (`padding`) корневого
  элемента `UserMessage` и `AgentMessage`, не `margin`: внешний отступ выпадает из замера
  высоты, и лента прыгает.
- **Стили не зависят от «последний ли элемент»**. Это касается любого ответа, а не только длинного:
  чем больше в ответе таблиц и кода, тем дороже ошибка, но правило одно. Нельзя ставить правила и
  классы, у которых итог зависит от `:last-child`, `:not(:last-child)`, `:first-child` или `:has()` на
  предках текста ответа, и нельзя вставлять или убирать элементы рядом с пузырём ответа, когда ответ
  дописан. От смены «последний ли» браузер пересчитывает стили всего поддерева разом, и долгая задача
  растёт с длиной ответа. Пример из Тандема: правило `.tandem-markdown tr:last-child td` заставляет
  браузер пересчитать каждую ячейку каждой таблицы ответа, если пузырь стал не последним в колонке
  (в конце ответа под ним появилась строка с кнопками): на ответе из 50 000 символов это 1 155 элементов
  за раз, долгая задача растёт вместе с ответом (R16).
  - **Строка под пузырём** присутствует в дереве всегда, порядок: пузырь, потом строка. Пока ответ
    пишется, она скрыта (`hidden`) и пуста; в конце ответа в неё добавляется содержимое, а сам элемент
    не появляется. Так пузырь не меняет своё «последний ли».
  - **Отступы между блоками текста** скин задаёт из кода, по номеру блока (`index > 0`,
    `index < blocks.length - 1`), а не селекторами вроде `:not(:last-child)`.
  - **Как проверить**: `DEMO_E2E_PERF=1 pnpm --filter @ykurilov/agent-chat-demo exec playwright test --project=perf-phone
    --grep "правил скина"` (`perf-feed.spec.ts`) пишет трассу браузера огромного ответа и краснеет, если
    крупный пересчёт стилей (больше 1 000 элементов) вызван правилом из таблицы стилей. Форма строки под
    пузырём закреплена модульным тестом скина (`skins/tandem/tests/agent-message.test.tsx`: скрыта, пока
    ответ пишется, видна после, тот же элемент до и после).
- **Раскрытие**. `Reasoning` и `ToolCallRow` не держат своё состояние раскрытия: показывают
  `open` и сообщают о нажатии через `onOpenChange`. Компонент, которому раскрытие не нужно
  (например, строка журнала в демо), может эти пропсы не использовать.
- **Надписи** — только из `useChatLabels()` ([labels.md](./labels.md)).

## Где рисуется состояние

- Ответ с `status: "error"` — `ErrorNotice` в `AgentMessage.notice` (как в версии 1).
- Сервер отказал в отправке (ответил ошибкой) — `ErrorNotice kind="other"` в `Layout.notice`
  (как в версии 1).
- Вкладка переподключается — `ConnectionNotice state="reconnecting"` в `Layout.notice`;
  поле ввода в состоянии `busy`, «стоп» доступен.
- Связи нет (попытки исчерпаны — после тишины, обрыва или отправки, не дошедшей по сети или
  сроку; либо история не загрузилась по сети или сроку) — `ConnectionNotice state="offline"
  onRetry` в `Layout.notice`.
- Чат чужой или его нет — только `ChatNotFound` (как в версии 1).

## Обёртки элементов ленты

Поведение оборачивает каждое сообщение в элемент окна ленты с атрибутом `data-feed-item`
и служебными стилями положения (`position`, `top`, `width`). Вида у обёртки нет. Проверки
считают по этому атрибуту, сколько сообщений на странице (SC-003).

## Замена компонента

Без изменений: `skin={{ ...tandemSkin, ToolCallRow: MyToolCallRow }}`. Заменённый компонент
рисуется и в окне ленты.

## Скин Тандема (`skins/tandem`) — что меняется

| Компонент | Правка |
|---|---|
| `Layout` | убрать `useLayoutEffect` и `onScroll` прилипания; `ref={scrollRef}` на скроллер; `role="log" aria-live="off"`; вместо `gap-6` — отступы в сообщениях; `announcement` в `sr-only` с `aria-live="polite"`; `notice` как раньше |
| `UserMessage`, `AgentMessage` | внутренний отступ корня вместо `gap` контейнера |
| `Reasoning`, `ToolCallRow` | `open`/`onOpenChange` вместо `useState` |
| `ConnectionNotice` | новый: тихая строка «Переподключаемся…» (спокойная пульсация, как у идущего инструмента) и `Alert variant="warm"` «Нет связи с сервером» с `Button` «Повторить», как у `ErrorNotice` |

## Проверка договора

Те же тесты поведения идут со скином-заглушкой и со скином Тандема; тест замены — как в
версии 1; новый тест: раскрыть рассуждение, прокрутить его за край окна и обратно — раскрыто.
