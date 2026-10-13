# Договор: экран и скин v13 (US1–US6)

Договор скина `ChatSkin` v13: все новые части **необязательные**. Скин v10 работает без правок: виджеты показаны запасным видом «ответьте сообщением» в строке инструмента, схемы — кодом, картинки — строкой инструмента, окно просмотра не открывается (FR-033).

## Свойства страницы

```tsx
<AgentChat | ChatWorkspace | AgentPanel
  widgets?={{ pick_slot: PickSlotWidget }}  // свои виджеты: имя → компонент
  diagrams?={diagramsClient}                 // contracts/diagrams.md
  images?={imagesClient}                     // contracts/images.md
/>
```

Базовые виджеты свойств не требуют: их рисует скин, если на сервере включены `agent.widgets`.

## Свой виджет

```ts
interface CustomWidgetProps<Input = unknown, Answer = unknown> {
  input: Input;
  state: "pending" | "answered" | "answered_by_message" | "closed"; // closed — «Стоп», сбой, не текущая ветка
  answer?: Answer;
  onAnswer?: (answer: Answer) => void;   // есть только у активного виджета
  pending: boolean;                      // ответ отправляется
  failure?: string;                      // текст ошибки на языке собеседника
}
```

## Новые части скина

```ts
interface ChatSkin {
  // …v10…
  /** Ждущий базовый виджет и его итог. Нет — запасной вид в ToolCallRow. */
  Widget?: ComponentType<WidgetView>;
  /** Кнопки-подсказки под последним законченным ответом. */
  SuggestedReplies?: ComponentType<{ replies: string[]; onPick: (text: string) => void; disabled: boolean }>;
  /** Картинки агента (US5). */
  GeneratedImages?: ComponentType<GeneratedImagesView>;
  /** Окно просмотра картинок и схем (US6). */
  MediaViewer?: ComponentType<MediaViewerProps>;
}

AgentText: ComponentType<{
  markdown: string;
  streaming: boolean;
  /** v13: есть, если подключён diagramsClient. Скин зовёт для каждого блока ```mermaid. */
  renderDiagram?: (source: string, blockIndex: number) => DiagramView;
  /** v13: открыть схему в окне просмотра. */
  onOpenDiagram?: (blockIndex: number, trigger: HTMLElement) => void;
}>;

UserMessage / MessageEditor: attachments.items[i] получает v13 `onOpen?: (trigger: HTMLElement) => void` — открыть картинку в окне.
```

### Вид виджета

```ts
type WidgetView = {
  toolCallId: string;
  active: boolean;                 // можно нажимать (последний ответ ветки, ждёт)
  pending: boolean;                // ответ отправляется: кнопки неактивны
  failure?: string;
  answeredByMessage: boolean;      // показать «Ответ дан сообщением»
} & (
  | { kind: "choice"; question: string; options: string[]; chosen?: string; onChoose?: (option: string) => void }
  | { kind: "multi_choice"; question: string; options: string[]; min: number; max: number; chosen?: string[]; onSubmit?: (options: string[]) => void }
  | { kind: "rating"; question: string; scale: "stars" | "range"; from: number; to: number; fromLabel?: string; toLabel?: string; value?: number; onRate?: (value: number) => void }
  | { kind: "form"; title: string; fields: FormFieldView[]; values?: Record<string, string | number>; onSubmit?: (values: Record<string, string | number>) => void }
  | { kind: "custom"; name: string; question?: string; content?: ReactNode } // content — компонент приложения; нет — запасной вид
);
```

Проверку формы и выбора (min/max, обязательные поля, пределы чисел и дат) делает слой поведения: `onSubmit` неверных значений не отправляет, а скин получает `failure` поля через `FormFieldView.error`.

### Схема

```ts
type DiagramView =
  | { state: "streaming" }                    // заглушка «Схема рисуется…»
  | { state: "ready"; svg: string; source: string } // чистый SVG; скин кладёт его как разметку, а диктору — «схема» и source (FR-031)
  | { state: "failed"; source: string };      // показать исходник блоком кода
```

Скин передаёт рисовальщику свои цвета через слой поведения: `ChatSkin.diagramColors?: (dark: boolean) => DiagramColors`.

### Картинки

```ts
interface GeneratedImagesView {
  ordered: number;                                          // заказано
  aspectRatio: string;
  items: Array<
    | { state: "loading"; key: string }                    // заглушка нужной пропорции
    | { state: "ready"; key: string; src: string; alt: string; width?: number; height?: number; onOpen: (trigger: HTMLElement) => void }
    | { state: "failed"; key: string; reason: string }
  >;
  stopped: boolean;
}
```

### Окно просмотра

```ts
interface MediaViewerProps {
  items: MediaViewerItem[];        // data-model, «Элемент окна просмотра»
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;             // слой поведения возвращает фокус на элемент-источник
}
```

Обязанности скина: крестик, Esc, клик по фону, ←/→, свайп, стрелки и счётчик «3 из 12» (если элементов больше одного), масштаб колесом и щипком, перетаскивание, «вписать», фокус внутри окна (`role="dialog"`, `aria-modal`). Схема — векторный SVG без перевода в картинку.

Обязанности слоя поведения: состав карусели (картинки человека и агента текущей ветки по порядку ленты; схема — одна), запись в истории браузера, чтобы жест «назад» закрыл окно, возврат фокуса.

## Подписи

Новые ключи `ChatLabels` (ru/en, свои подписи приложения перекрывают): `widgets.answeredByMessage`, `widgets.submit` («Готово»), `widgets.choose`, `widgets.ratingStars`, `widgets.answerFailed`, `widgets.notCurrentBranch`, `widgets.fallback` («Ответьте сообщением»), `widgets.formRequired`, `diagram.loading`, `diagram.failed`, `diagram.open`, `images.loading`, `images.failed`, `images.stopped`, `images.open`, `viewer.close`, `viewer.next`, `viewer.previous`, `viewer.fit`, `viewer.counter` («{n} из {total}»), `voice.diagramOnScreen` («схема на экране»).
