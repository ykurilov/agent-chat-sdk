# Contract: договор скина

Объявлен в `@ykurilov/agent-chat-react` (`skin-contract.ts`). Слой поведения собирает ленту
из компонентов скина и сам не рисует ничего своего (принцип II). Изменение договора —
MAJOR-версия пакета поведения.

```ts
interface ChatSkin {
  Layout: ComponentType<{ feed: ReactNode; composer: ReactNode; notice?: ReactNode }>
  UserMessage: ComponentType<{ text: string }>
  AgentMessage: ComponentType<{
    status: "streaming" | "complete" | "stopped" | "error" | "interrupted"
    children: ReactNode            // части ответа в порядке прихода
    onCopy: () => void             // скопировать ответ целиком (FR-004)
    empty: boolean                 // модель не написала текста
    onRetry?: () => void           // «повторить» у стопа, прерывания, пустого ответа; только у последнего (FR-017)
    notice?: ReactNode             // блок ошибки ответа (ErrorNotice), под написанной частью
  }>
  AgentText: ComponentType<{ markdown: string; streaming: boolean }>   // FR-002, код с копированием
  Reasoning: ComponentType<{
    text: string
    streaming: boolean
    durationMs: number | null      // null пока идёт
    defaultOpen: false
  }>
  ToolCallRow: ComponentType<{
    toolName: string
    state: "running" | "done" | "error"                                 // FR-010
    input?: unknown
    output?: unknown
    errorText?: string
  }>
  ErrorNotice: ComponentType<{ kind: ChatErrorKind; onRetry?: () => void }>  // FR-016; без onRetry — без кнопки
  ChatNotFound: ComponentType      // вместо всего чата, если сервер ответил 404: чат чужой или его нет (US5-2)
  Composer: ComponentType<{
    value: string
    onValueChange: (value: string) => void
    onSubmit: () => void
    canSubmit: boolean             // false: пусто, пробелы или идёт ответ
    busy: boolean                  // идёт ответ
    onStop: () => void             // FR-003, FR-014
  }>
}
```

Где рисуется ошибка:
- ответ с `status: "error"` — `ErrorNotice` приходит в `AgentMessage` через `notice`; кнопка
  «повторить» только в нём, `onRetry` у самого ответа тогда не передаётся;
- сообщение собеседника не дошло до сервера — `ErrorNotice kind="other"` в `Layout.notice`,
  «повторить» отправляет то же сообщение заново;
- чат чужой или его нет (сервер ответил `404`) — только `ChatNotFound`, без `Layout`, поля
  ввода и «повторить»: ответ окончательный.

Все надписи компоненты берут из `useChatLabels()` ([labels.md](./labels.md)), а не пишут в коде.

## Замена компонента (FR-027)

```tsx
<AgentChat chatId={id} api="/api/chat" skin={{ ...tandemSkin, ToolCallRow: MyToolCallRow }} />
```

## Скин Тандема (`skins/tandem`)

| Компонент договора | Из чего собран в `@tandem/ui` |
|---|---|
| `UserMessage` | `UserMessage` (без `onEdit` — правки нет в срезе) |
| `AgentMessage` | `AgentMessage side="agent"` с детьми-частями и кнопкой копирования (`Button`) |
| `AgentText` | `Markdown` |
| `Reasoning` | свёрнутый блок по правилам `agent-chat.md` Тандема |
| `ToolCallRow` | спокойная строка с `Badge` состояния |
| `ErrorNotice` | `Alert` с действием «повторить» |
| `ChatNotFound` | надпись по центру с иконкой, без действий |
| `Composer` | `Composer variant="minimal"` + своя кнопка «стоп» (`Button`), пока в Composer её нет |
| `Layout` | колонка ленты и поле ввода внизу, адаптив под телефон |

Проверка договора: одни и те же тесты поведения идут со скином-заглушкой из тестов и со
скином Тандема; тест замены — подменённый `ToolCallRow` рисуется, остальные компоненты
прежние (US5-3).
