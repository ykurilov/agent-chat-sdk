import type { ComponentType, ReactElement, ReactNode, RefObject } from "react";
import type { ComposerAttachments, MessageAttachmentsView } from "./attachments-contract";
import type { AnswerStatus, ApprovalDecision, ErrorNoticeKind } from "./chat-types";
import type { MediaViewerItem } from "./media-viewer/media-viewer-types";
import type { VoiceDialogView } from "./voice-dialog";

/** Состояние вызова инструмента в ленте (FR-010). */
export type ToolCallState = "running" | "done" | "error";

/**
 * Подтверждение вызова инструмента в строке вызова (договор скина, версия 9).
 * `requested` — агент ждёт решения: показать что он хочет сделать и три кнопки; `pending` — ответ уходит на сервер
 * (кнопки заняты), `failed` — не вышло, можно нажать ещё раз; `failureText` — почему, готовой надписью (нет — общая
 * `approvalFailed`). `canAlways` — кнопку «Всегда в этом чате» показывать только при `true`: для вызова, чьё решение
 * зависит от входных данных, сервер её не предлагает. Остальное — итог решения, пометка без кнопок.
 */
export type ToolApprovalView =
  | {
      state: "requested";
      onDecide: (decision: ApprovalDecision) => void;
      pending: boolean;
      failed: boolean;
      failureText?: string;
      canAlways: boolean;
    }
  | { state: "allowed" | "always" | "denied" };

/** Состояние помощника в строке вызова (версия 18). `background` — помощник ушёл в фон, итог придёт служебным сообщением. */
export type HelperCallStatus = "running" | "awaiting_approval" | "done" | "failed" | "background";

/** Шаг помощника: вызов инструмента или кусок текста (версия 18). Результат вызова уже обрезан сервером. */
export type HelperStepView =
  | { kind: "tool"; id: string; toolName: string; title?: string; state: ToolCallState; input?: unknown; output?: unknown; errorText?: string }
  | { kind: "text"; id: string; text: string };

/**
 * Строка вызова помощника (версия 18): человек видит всё, что делал помощник, модель основного агента получает только
 * итог. Подтверждение помощника — тот же `ToolApprovalView`, что у обычного вызова.
 */
export interface HelperCallView {
  /** Имя помощника, `helper_<имя>` без приставки; нет названия — показывать его. */
  name: string;
  title?: string;
  /** Задание, которое получил помощник. */
  task: string;
  steps: HelperStepView[];
  /** Итог помощника; пока он работает — то, что уже написано. */
  text: string;
  status: HelperCallStatus;
  approval?: ToolApprovalView;
  /** Что помощник хочет сделать, пока ждёт решения: его инструмент, `title` инструмента и входные данные. */
  approvalAction?: { toolName: string; title?: string; input?: unknown };
  errorText?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Состояние фоновой задачи в карточке (версия 18). */
export type TaskStatusView = "queued" | "running" | "awaiting_approval" | "done" | "failed" | "canceled" | "interrupted" | "timed_out";

/** Карточка фоновой задачи (версия 18). `onCancel` есть, пока задачу можно отменить. */
export interface TaskCardView {
  id: string;
  title: string;
  status: TaskStatusView;
  /** Сколько идёт (или шла) задача, миллисекунды; готовой надписью её делает скин через `labels.tasks.elapsed`. */
  elapsedMs: number;
  onCancel?: () => void;
  /** Отмена ушла на сервер, ответа ещё нет: кнопку сделать занятой. */
  canceling?: boolean;
}

/** Что случилось, о чём пишет служебное сообщение (версия 18). */
export type AgentNoticeViewKind =
  | "task_done"
  | "task_failed"
  | "task_canceled"
  | "task_interrupted"
  | "task_timed_out"
  | "task_awaiting_approval"
  | "conversation_started";

/**
 * Служебное сообщение в ленте (версия 18): рисуется плашкой, а не пузырём человека. Текст `result` и `errorText` —
 * только текстом, без разметки. У `task_awaiting_approval` есть `approval` — кнопки решения.
 */
export interface AgentNoticeViewProps {
  kind: AgentNoticeViewKind;
  title: string;
  result?: string;
  errorText?: string;
  approval?: ToolApprovalView;
}

/** Мессенджер, из которого создан чат (версия 18: пометка в списке чатов, `ChatListItem.origin`). */
export type ChatOriginView = "telegram" | "vk" | "max";

/** Выбор модели и уровня рассуждений в поле ввода (договор скина, версия 3). */
export interface ModelChoiceView {
  providers: Array<{ id: string; name: string; models: Array<{ id: string; name: string; acceptsImages?: boolean }> }>;
  /** Текущий выбор: провайдер и модель. */
  current: { providerId: string; modelId: string };
  onChange: (next: { providerId: string; modelId: string }) => void;
  /** Уровни выбранной модели по порядку профиля; пустой массив — выбор уровня не показывать. */
  reasoningLevels: Array<{ id: string; name: string }>;
  reasoning: string;
  onReasoningChange: (levelId: string) => void;
  /** Что пошло не так, готовой надписью: список не загрузился (тогда `providers` пуст) или выбор не сохранился (откачен). */
  error?: string;
}

/** Диктовка в поле ввода (договор скина, версия 5). */
export interface VoiceInputView {
  state: "idle" | "connecting" | "listening" | "stopping";
  /** Нажатие: начать диктовку или закончить. Во время подключения — отменить. */
  onToggle: () => void;
  /** Текст надиктован, и сервер причёсывает его моделью: показать тихий признак (необязательное поле, скины без него работают). */
  polishing?: boolean;
  /** Что пошло не так, готовой надписью. */
  error?: string;
}

/** Поле формы `ask_form` для скина; `error` — готовая надпись об ошибке поля (проверка до отправки, слой поведения). */
export interface FormFieldView {
  name: string;
  label: string;
  kind: "text" | "number" | "date" | "select";
  required: boolean;
  /** Пределы: число у `number`, дата `YYYY-MM-DD` у `date`. */
  min?: number | string;
  max?: number | string;
  /** Варианты `select`. */
  options?: string[];
  /** Многострочное текстовое поле. */
  multiline?: boolean;
  error?: string;
}

/**
 * Вид базового или своего виджета для скина (версия 13). Проверку формы и выбора (min/max, обязательные поля, пределы
 * чисел и дат) делает слой поведения: `onSubmit` неверных значений не отправляет, а скин получает ошибку поля в
 * `FormFieldView.error`.
 */
export type WidgetView = {
  toolCallId: string;
  /** Можно нажимать: последний ответ ветки ждёт. */
  active: boolean;
  /** Ответ отправляется: кнопки неактивны. */
  pending: boolean;
  failure?: string;
  /** Показать «Ответ дан сообщением» (`labels.widgets.answeredByMessage`). */
  answeredByMessage: boolean;
} & (
  | { kind: "choice"; question: string; options: string[]; chosen?: string; onChoose?: (option: string) => void }
  | { kind: "multi_choice"; question: string; options: string[]; min: number; max: number; chosen?: string[]; onSubmit?: (options: string[]) => void }
  | {
      kind: "rating";
      question: string;
      scale: "stars" | "range";
      from: number;
      to: number;
      fromLabel?: string;
      toLabel?: string;
      value?: number;
      onRate?: (value: number) => void;
    }
  | { kind: "form"; title: string; fields: FormFieldView[]; values?: Record<string, string | number>; onSubmit?: (values: Record<string, string | number>) => void }
  /** `content` — компонент приложения из `widgets[name]`; нет — запасной вид: вопрос и `labels.widgets.fallback`. */
  | { kind: "custom"; name: string; question?: string; content?: ReactNode }
);

/** Свойства компонента своего виджета (`widgets={{ имя: Компонент }}` у страницы). */
export interface CustomWidgetProps<Input = unknown, Answer = unknown> {
  input: Input;
  /**
   * Чат, где задан вопрос, и id вызова инструмента: по ним компонент сам загрузит свои данные (тот же `toolCallId`
   * видит `checkAnswer` на сервере). `AgentChat` передаёт оба всегда; в типе они необязательные, чтобы свои тесты
   * компонента без них не сломались.
   */
  chatId?: string;
  toolCallId?: string;
  /** `closed` — «Стоп», сбой или другая ветка. */
  state: "pending" | "answered" | "answered_by_message" | "closed";
  answer?: Answer;
  /** Есть только у активного виджета. */
  onAnswer?: (answer: Answer) => void;
  /** Ответ отправляется. */
  pending: boolean;
  /** Текст ошибки на языке собеседника. */
  failure?: string;
}

/** Цвета схемы: их отдаёт скин (`diagramColors`), по ним рисовальщик красит схему. Совпадает с `DiagramColors` пакета схем. */
export interface DiagramColors {
  background: string;
  text: string;
  line: string;
  node: string;
  accent: string;
  dark: boolean;
}

/** Схема из блока ```mermaid ответа (версия 13). */
export type DiagramView =
  /** Блок печатается или рисуется: заглушка `labels.diagram.loading`. */
  | { state: "streaming" }
  /** `svg` — чистая разметка, скин кладёт её как есть; диктору — «схема» и `source`. */
  | { state: "ready"; svg: string; source: string }
  /** Не нарисовалась: показать исходник блоком кода. */
  | { state: "failed"; source: string };

/**
 * Цвета живой демонстрации (версия 22): их отдаёт скин (`demoColors`), внутрь рамки они идут CSS-переменными `--bg`,
 * `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--on-accent`.
 */
export interface LiveDemoColors {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  /** Текст на заливке `accent`. */
  onAccent: string;
  dark: boolean;
}

/** Живая демонстрация из блока ```html-demo ответа (версия 22, docs/live-demos.md). */
export type LiveDemoView =
  /** Блок дописывается: плашка `labels.demo.loading`. */
  | { state: "streaming" }
  /**
   * `frame` — готовая изолированная рамка слоя поведения: скин кладёт её как есть, во всю ширину ответа, и не меняет
   * её атрибуты. Высоту рамка держит сама.
   */
  | { state: "ready"; source: string; frame: ReactElement }
  /** Не запускается: показать исходник блоком кода и пометку `labels.demo[reason]`. */
  | { state: "code"; source: string; reason: "tooLarge" | "unfinished" | "leftPage" | "externalContent" };

/** Картинки агента из вызова `generate_images` (версия 13). */
export interface GeneratedImagesView {
  /** Заказано картинок. */
  ordered: number;
  /** Пропорция, например `"16:9"`: заглушки и готовые картинки её держат, чтобы лента не прыгала. */
  aspectRatio: string;
  items: Array<
    | { state: "loading"; key: string }
    | { state: "ready"; key: string; src: string; alt: string; width?: number; height?: number; onOpen: (trigger: HTMLElement) => void }
    | { state: "failed"; key: string; reason: string }
  >;
  /** Человек нажал «Стоп»: показать `labels.images.stopped`. */
  stopped: boolean;
}

/**
 * Видео агента из вызова `show_video` (версия 14). Плеер грузить только по нажатию на карточку: до него к площадке
 * не уходит ни одного запроса. Играет или нет — держит сам скин.
 */
export interface AgentVideoView {
  /** id вызова `show_video`: годится в `key` и в id элементов. */
  id: string;
  title: string;
  provider: "youtube" | "kinescope";
  /** Адрес встроенного плеера с автозапуском и стартом; собран из площадки и кода, а не взят из базы как есть. */
  embedUrl: string;
  /** Страница видео на площадке с тем же стартом. */
  pageUrl: string;
  /** Обложка из каталога приложения. Нет — своя заглушка, не картинка с площадки. */
  poster?: string;
  /** «18:40». */
  duration?: string;
  /** С какой минуты начнётся, «3:20»: показать `labels.videos.from(start)`. */
  start?: string;
}

/** Окно просмотра картинок и схем (версия 13). Фокус после закрытия возвращает слой поведения. */
export interface MediaViewerProps {
  items: MediaViewerItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * Своя кнопка приложения под ответом агента (версия 17): подпись и иконку задало приложение, иконка — готовый элемент.
 * `busy` — обработчик ещё идёт: кнопку показать неактивной, `onRun` не звать.
 */
export interface MessageActionView {
  id: string;
  label: string;
  icon?: ReactNode;
  busy: boolean;
  onRun: () => void;
}

/**
 * Работа агента в простом виде (версия 23, `workView: "simple"` у `AgentChat`). `live` — ход идёт: одна строка с текущим
 * шагом, уже с многоточием («Рисую календарь…»); фраза меняется часто — диктору её не читать на каждой смене.
 * `done` — шаги свёрнуты: строка `labels.workView.stepsDone(count)` (`count` — число вызовов вместе с повторами),
 * раскрытие — список фраз (одинаковые подряд уже схлопнуты в «… ×N»; `failed` — шаг не получился или не закончен,
 * отметить тихо). Фразы — только текст, без разметки, не длиннее 120 знаков, но слово может быть длинным — переносить.
 */
export type WorkStepsView =
  | { state: "live"; phrase: string }
  | { state: "done"; steps: Array<{ phrase: string; failed: boolean }>; count: number; open: boolean; onOpenChange: (open: boolean) => void };

/** Реплика живого сотрудника человеку (версия 25, `ChatService.appendStaffMessage`): сказано от имени компании, не агентом. */
export interface StaffMessageView {
  /** Что сотрудник написал человеку: обычный текст, без разметки. */
  text: string;
  /** Имя сотрудника («Ольга»); нет — подписать просто «сотрудник». */
  staffName?: string;
}

/**
 * Договор скина, версия 25 (в версии 25 добавилось только необязательное `StaffMessage` — реплика живого сотрудника,
 * docs/skin-v25.md; скин версии 24 работает без правок: реплика показывается ответом агента с подписью
 * `labels.notices.staffSaid`).
 * Версия 24 (в версии 24 добавилось только необязательное `AgentMessage.undelivered` — отметка
 * «не доставлено», docs/skin-v24.md; скин версии 23 работает без правок: отметки нет).
 * Версия 23 (в версии 23 добавилось только необязательное `WorkSteps` — простой вид работы агента,
 * docs/work-view.md; скин версии 22 работает без правок: в простом виде шаги рисуются строкой `ToolCallRow` с фразой
 * в `title`, без входа, а в результате — список понятных фраз текстом).
 * Версия 22 (в версии 22 добавились только необязательные `AgentText.renderDemo` и `demoColors` — живые
 * демонстрации, docs/skin-v22.md; скин версии 21 работает без правок: блок ```html-demo показывается кодом).
 * Версия 21 (в версии 21 добавились только необязательные `Composer.canSteer` и `UserMessage.pending` —
 * поправка во время ответа, docs/skin-v21.md; скин версии 20 работает без правок: во время ответа поле не
 * отправляет, поправок нет).
 * Версия 20 (в версии 20 добавилось только необязательное `ChatClosedNotice` — надпись закрытого чата,
 * а у `ChatListSkin.ChatWorkspace` свойство `list` стало необязательным, docs/skin-v20.md; скин
 * версии 19 работает без правок: закрытие показывает `ErrorNotice` с текстом).
 * Версия 19 (в версии 19 добавилось только необязательное `Composer.actions` — кнопки приложения у поля
 * ввода, docs/skin-v19.md; скин версии 18 работает без правок: этих кнопок нет).
 * Версия 18 (в версии 18 добавились только необязательные `HelperCallRow`, `TaskCard` и `AgentNoticeView`
 * и тип `ChatOriginView` для пометки мессенджера в списке чатов, docs/skin-v18.md;
 * скин версии 17 работает без правок: вызов помощника — обычной строкой инструмента, задачи не показываются, служебное
 * сообщение — короткой строкой).
 * Версия 17 (в версии 17 добавилось только необязательное `AgentMessage.actions` — свои кнопки приложения
 * под ответом; скин версии 16 работает без правок: этих кнопок нет).
 * Версия 16 (в версии 16 добавилось только необязательное `ErrorNotice.text` — текст отказа сервера;
 * скин версии 15 работает без правок: вместо текста сервера общая надпись).
 * Версия 15 (в версии 15 добавились только необязательные `AgentMessage.onEdit`, `AgentMessage.edited` и
 * `ToolCallRow.outputEdited` для правки ответа в песочнице, docs/sandbox.md; скин версии 14 работает без
 * правок: кнопки правки и отметок «изменено» нет).
 * Версия 14 (в версии 14 добавилась только необязательная `AgentVideo`, docs/videos.md;
 * скин версии 13 работает без правок: видео показывается ссылкой в тексте ответа).
 * Версия 13 (в версии 13 добавились только необязательные `Widget`, `SuggestedReplies`, `GeneratedImages`,
 * `MediaViewer`, `diagramColors`, `AgentText.renderDiagram`/`onOpenDiagram` и `MessageAttachmentItem.onOpen`,
 * docs/contracts/agent-widgets/react-and-skin.md; скин версии 10 работает без правок: виджеты показываются запасным
 * видом в строке инструмента, схемы — кодом, картинки — строкой инструмента, окно просмотра не открывается).
 * Версия 10 (добавились только необязательные `Composer.dialog`, `AgentMessage.voiceInterrupted` и `AgentMessage.cutByLength`,
 * docs/contracts/voice-dialog/skin.md; версия 7 — отдельный `ChatListSkin` для `ChatWorkspace`, см. chat-list/chat-list-skin.ts; в версии 5 добавились только необязательные `Composer.voice`, `Composer.attachments`
 * и `UserMessage.attachments`, в версии 6 — `BranchSwitcher`, `MessageEditor` и свойства веток у сообщений, в версии 8 —
 * только необязательные `SpendingNotice` и `Composer.sendingBlocked`, в версии 9 — только необязательные
 * `ToolCallRow.title` и `ToolCallRow.approval`): слой поведения
 * собирает ленту только из этих
 * компонентов и ничего своего не рисует. Надписи компоненты берут из `useChatLabels()`.
 */
export interface ChatSkin {
  Layout: ComponentType<{
    feed: ReactNode;
    composer: ReactNode;
    notice?: ReactNode;
    /** Повесить на элемент, который прокручивается; `feed` положить внутрь него. */
    scrollRef: RefObject<HTMLDivElement | null>;
    /** Текст для диктора: положить в визуально скрытый элемент с `aria-live="polite"`. */
    announcement: string;
  }>;
  UserMessage: ComponentType<{
    text: string;
    /** Файлы сообщения (миниатюры картинок и плашки); нет — у сообщения только текст. */
    attachments?: MessageAttachmentsView;
    /** Переключатель веток (`BranchSwitcher`), если у сообщения есть соседи: положить рядом с сообщением. */
    branchSwitcher?: ReactNode;
    /** «Изменить»: нет — правка сейчас недоступна (идёт ответ, нет связи). */
    onEdit?: () => void;
    /**
     * Поправка, которую агент ещё не взял (версия 21): показать пометку `labels.steeringPending` у сообщения. Агент взял
     * поправку — сообщение придёт без `pending`.
     */
    pending?: boolean;
  }>;
  /**
   * Переключатель веток «‹ 2/3 ›»: `position` считается с 1, `count` — сколько всего вариантов.
   * Обработчика нет на краю (нет предыдущего или следующего) и пока идёт ответ: кнопку показать неактивной.
   */
  BranchSwitcher: ComponentType<{ position: number; count: number; onPrevious?: () => void; onNext?: () => void }>;
  /**
   * Правка отправленного сообщения. Слой поведения показывает её вместо `UserMessage` и сам хранит черновик:
   * скин рисует поле с `value`, кнопки «Отправить» (`onSave`) и «Отмена» (`onCancel`); `canSave` — `false` для пустого текста.
   * Файлы сообщения при правке остаются как были: `attachments` — их показать над полем, без кнопок «убрать».
   */
  MessageEditor: ComponentType<{
    value: string;
    onValueChange: (value: string) => void;
    onSave: () => void;
    onCancel: () => void;
    canSave: boolean;
    /** Почему правку не удалось отправить (текст уже на языке собеседника): показать под полем как `role="alert"`; текст в поле остаётся. */
    error?: string;
    attachments?: MessageAttachmentsView;
  }>;
  AgentMessage: ComponentType<{
    status: AnswerStatus;
    /** Части ответа в порядке прихода. */
    children: ReactNode;
    /** Скопировать ответ целиком. */
    onCopy: () => void;
    /** Модель не написала текста. */
    empty: boolean;
    /** «Повторить» у остановленного, прерванного или пустого ответа; только у последнего ответа. */
    onRetry?: () => void;
    /** Блок ошибки ответа (`ErrorNotice`), рисуется под написанной частью. */
    notice?: ReactNode;
    /** Переключатель веток (`BranchSwitcher`), если у ответа есть соседи (переделки). */
    branchSwitcher?: ReactNode;
    /** «Переделать ответ» с чистого листа; только у последнего ответа: законченного или оборванного на вызовах инструментов (рядом с «Повторить»). */
    onRegenerate?: () => void;
    /** Озвучку ответа оборвало перебивание (версия 10): показать отметку «Вы перебили: озвучено до «…»» из `labels.voiceDialog.interruptedMark`. */
    voiceInterrupted?: { spokenTail: string };
    /** Ответ оборван пределом длины ответа модели (версия 10, необязательное): показать отметку `labels.answerCutByLength`. */
    cutByLength?: boolean;
    /** «Изменить ответ» (версия 15, необязательное): есть только в песочнице и только у законченного ответа; подпись `labels.editAnswer`. */
    onEdit?: () => void;
    /** Ответ исправил человек (версия 15, необязательное): показать отметку `labels.answerEdited`. */
    edited?: boolean;
    /**
     * Ответ не дошёл до человека (версия 24, необязательное): показать серую отметку `labels.answerUndelivered`. Модель
     * этот ответ больше не видит.
     */
    undelivered?: boolean;
    /**
     * Свои кнопки приложения (версия 17, необязательное): нарисовать в ряду действий под ответом, после встроенных, в том
     * же виде. Пока ответ пишется, их нет.
     */
    actions?: MessageActionView[];
  }>;
  AgentText: ComponentType<{
    markdown: string;
    streaming: boolean;
    /** Версия 13: есть, если подключён `diagrams`. Скин зовёт для каждого блока ```mermaid; нет — блок как обычный код. */
    renderDiagram?: (source: string, blockIndex: number) => DiagramView;
    /** Версия 13: открыть готовую схему в окне просмотра. */
    onOpenDiagram?: (blockIndex: number, trigger: HTMLElement) => void;
    /**
     * Версия 22: есть, если подключены `liveDemos`. Скин зовёт для каждого блока ```html-demo (номер — порядок среди таких
     * блоков, `splitAnswerFences`); нет — блок как обычный код.
     */
    renderDemo?: (source: string, blockIndex: number) => LiveDemoView;
  }>;
  Reasoning: ComponentType<{
    text: string;
    streaming: boolean;
    /** `null`, пока рассуждение идёт. */
    durationMs: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>;
  ToolCallRow: ComponentType<{
    toolName: string;
    /** Название действия по-человечески, если приложение его задало (`title` инструмента); нет — показывать `toolName`. */
    title?: string;
    /** Есть, если вызов требует подтверждения (версия 9). Нет — обычная строка вызова. */
    approval?: ToolApprovalView;
    state: ToolCallState;
    /** Вход вызова; пока модель его пишет — частичный. */
    input?: unknown;
    output?: unknown;
    errorText?: string;
    /** Результат вызова исправил человек (версия 15, необязательное): показать отметку `labels.toolOutputEdited`. */
    outputEdited?: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>;
  /**
   * Понятная ошибка вместо сырого текста провайдера; кнопка «повторить» — если передан `onRetry`. Кроме ошибок ответа
   * приходят `signed_out` (вход истёк), `too_many_turns` (идут ответы в других чатах) и `forbidden_origin` (сервер не признал страницу своей); текст — `labels.errors[kind]`.
   * `text` (версия 16, необязательное) — причина отказа словами сервера (4xx с текстом, до 300 знаков, `kind` — `other`):
   * показать вместо `labels.errors[kind]` только как текст, без разметки. Скин версии 15 покажет общую надпись.
   */
  ErrorNotice: ComponentType<{ kind: ErrorNoticeKind; text?: string; onRetry?: () => void }>;
  /**
   * Состояние связи с сервером. `reconnecting` — тихая строка «Переподключаемся…», без кнопок;
   * `offline` — «Нет связи с сервером» с «Повторить» (`onRetry` только у него).
   */
  ConnectionNotice: ComponentType<{ state: "reconnecting" | "offline"; onRetry?: () => void }>;
  /**
   * Разделитель на границе сжатой истории: сразу после последнего сообщения, которое заменила сводка.
   * Свёрнутый — строка «История сжата» (`labels.historyCompacted`); раскрытый — ещё и `summary` в Markdown.
   * `summary` пуст — сводка скрыта правами зрителя (`modelDetails: false`): раскрывать нечего, только строка.
   */
  CompactionDivider: ComponentType<{
    summary: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>;
  /**
   * Лимит расходов (версия 8): `warning` — расход подошёл к лимиту, чат работает; `exhausted` — лимит исчерпан, поле
   * ввода неактивно; `none` — причин нет, `text` пуст. `text` — готовая надпись из словаря. Рисуется рядом с полем ввода
   * (в слоте `Layout.notice`) и вызывается всегда, когда включены лимиты: область для диктора (`role="status"`) должна
   * быть в странице ещё до того, как в неё придёт текст, а при `none` — ничего не показывать и места не занимать.
   * `id` повесить на этот элемент: на него ссылается `Composer.sendingBlockedReasonId`. Элемент фокусируемый программно
   * (`tabIndex={-1}`): туда уходит фокус, когда поле ввода стало неактивным.
   * Нет — надписи про лимит не будет, только неактивное поле; скину с лимитами компонент нужен.
   */
  SpendingNotice?: ComponentType<{ id: string; state: "none" | "warning" | "exhausted"; text: string }>;
  /**
   * Чат закрыт (версия 20): `message` — слова приложения (до 300 знаков, только как текст), `code` — для оформления.
   * Рисуется рядом с полем ввода (в слоте `Layout.notice`), пока чат закрыт; поле при этом неактивно. `id` повесить на
   * элемент: на него ссылается `Composer.sendingBlockedReasonId`. Нет — слой поведения покажет `ErrorNotice` с текстом.
   */
  ChatClosedNotice?: ComponentType<{ id: string; code: string; message: string }>;
  /** Вместо всего чата, если он чужой или его нет: без ленты, поля ввода и «повторить». */
  ChatNotFound: ComponentType;
  Composer: ComponentType<{
    value: string;
    onValueChange: (value: string) => void;
    onSubmit: () => void;
    /** `false`: пусто, одни пробелы или идёт ответ. */
    canSubmit: boolean;
    /** Идёт ответ. */
    busy: boolean;
    /**
     * Поправка во время ответа (версия 21). Есть — идёт ответ, а поле принимает поправки: рядом со «Стоп» рисовать
     * «Отправить», `onSubmit` отправит поправку; `true` — введённое можно отправить сейчас (как `canSubmit` вне ответа).
     * Нет — во время ответа поле не отправляет (`canSubmit` — `false`).
     */
    canSteer?: boolean;
    onStop: () => void;
    /** Нет — рисовать поле без выбора. `providers` пуст — список грузится или не загрузился: меню не рисовать. */
    modelChoice?: ModelChoiceView;
    /**
     * Вложения (версия 5). Есть — рисовать скрепку, превью с удалением, принимать перетаскивание и вставку файлов,
     * показывать `notice`; отправка доступна и при пустом тексте (`canSubmit` уже учтено). Нет — вложений в приложении нет,
     * ничего про них не рисовать.
     */
    attachments?: ComposerAttachments;
    /** Нет — кнопку микрофона не рисовать. */
    voice?: VoiceInputView;
    /**
     * Отправка остановлена (версия 8): поле сделать неактивным. Причину называет `SpendingNotice` (лимит исчерпан) или
     * `ChatClosedNotice` (чат закрыт, версия 20).
     */
    sendingBlocked?: boolean;
    /** `id` надписи, объясняющей остановку: повесить на поле как `aria-describedby`. Приходит вместе с `sendingBlocked`. */
    sendingBlockedReasonId?: string;
    /**
     * Голосовой режим (версия 10). Есть — рисовать кнопку режима рядом с кнопкой диктовки и, пока `state !== "off"`,
     * панель режима: состояние словами, меню голосов, выход, надпись ошибки; поле ввода скрыть или сделать неактивным
     * (на телефоне без экранной клавиатуры). Нет — режима в приложении нет, ничего про него не рисовать.
     */
    dialog?: VoiceDialogView;
    /**
     * Кнопки приложения у поля ввода (версия 19): готовый узел, положить рядом с кнопками поля; в голосовом режиме
     * оставить видимым. Нет — кнопок нет.
     */
    actions?: ReactNode;
  }>;
  /** Версия 13. Ждущий или отвеченный виджет в ленте. Нет — запасной вид в `ToolCallRow` с пометкой «ответьте сообщением». */
  Widget?: ComponentType<WidgetView>;
  /** Версия 13. Кнопки-подсказки под последним законченным ответом. Нет — подсказки не показываются. */
  SuggestedReplies?: ComponentType<{ replies: string[]; onPick: (text: string) => void; disabled: boolean }>;
  /** Версия 13. Картинки агента. Нет — вызов `generate_images` остаётся строкой инструмента. */
  GeneratedImages?: ComponentType<GeneratedImagesView>;
  /** Версия 14. Видео агента: карточка, по нажатию — плеер. Нет — ссылка «▶ Название · с 3:20» через `AgentText`. */
  AgentVideo?: ComponentType<AgentVideoView>;
  /** Версия 17. Вызов помощника (`helper_<имя>`): задание, шаги, итог, подтверждение. Нет — обычная строка инструмента. */
  HelperCallRow?: ComponentType<HelperCallView>;
  /** Версия 17. Карточка фоновой задачи с «Отменить». Нет — задачи в ленте не показываются. */
  TaskCard?: ComponentType<TaskCardView>;
  /** Версия 17. Служебное сообщение: результат задачи, подтверждение, «агент написал первым». Нет — обычное сообщение. */
  AgentNoticeView?: ComponentType<AgentNoticeViewProps>;
  /** Версия 25. Реплика живого сотрудника. Нет — ответом агента с подписью «Сотрудник Ольга» (`labels.notices.staffSaid`). */
  StaffMessage?: ComponentType<StaffMessageView>;
  /** Версия 23. Простой вид работы агента: живая строка и свёрнутые шаги. Нет — то же строкой `ToolCallRow`. */
  WorkSteps?: ComponentType<WorkStepsView>;
  /** Версия 13. Окно просмотра картинок и схем. Нет — картинки и схемы не открываются. */
  MediaViewer?: ComponentType<MediaViewerProps>;
  /**
   * Версия 21. `true` — скин рисует поправки на лету: `Composer.canSteer` («Отправить» рядом со «Стоп») и
   * `UserMessage.pending` (пометка). Нет — во время ответа поле не отправляет, как до версии 21.
   */
  steering?: boolean;
  /** Версия 13. Цвета схемы для светлой (`false`) и тёмной (`true`) темы. Нет — рисовальщик берёт свои. */
  diagramColors?: (dark: boolean) => DiagramColors;
  /** Версия 22. Цвета живых демонстраций для светлой (`false`) и тёмной (`true`) темы. Нет — свои спокойные серые. */
  demoColors?: (dark: boolean) => LiveDemoColors;
}
