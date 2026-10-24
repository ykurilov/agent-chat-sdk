import type { ComponentType, CSSProperties, ReactNode } from "react";
import type {
  ClientCardField,
  FlowAfterEnd,
  FlowCondition,
  FlowConditionType,
  FlowDataOp,
  FlowField,
  FlowIssue,
  FlowNudges,
  FlowSchedule,
  FlowSideTask,
} from "../format/flow-format";
import type { DurationUnit, NudgesMode, SchedulePatch } from "./editor/schedule-model";
import type { SideTaskPatch } from "./editor/side-task-model";

export type { DurationUnit, NudgesMode, SchedulePatch, SideTaskPatch };

// Договор скина редактора сценария, версия 1. Слой поведения (`FlowEditor`, этап 5) считает всё сам — раскладку доски,
// пути стрелок, проверку, прогон — и собирает экран только из этих частей. Скин ничего не знает о библиотеке доски:
// ручки узлов и пути стрелок приходят готовыми. Надписи компоненты берут из `useFlowLabels().editor`.

/** Вид стрелки: по виду условия или «назад». */
export type FlowEdgeKind = FlowConditionType | "return";

/** Что открыто: правка, проверка графа, прогон. */
export type FlowEditorMode = "edit" | "check" | "run";

/** Сколько у места ошибок и замечаний проверки. */
export interface FlowIssueCount {
  errors: number;
  warnings: number;
}

/** Строка условия на карточке состояния. */
export interface FlowExitRowView {
  exitId: string;
  kind: FlowEdgeKind;
  /** Готовая подпись условия: «Понятны тема курса и продажи», «Тишина человека 3 ч». */
  text: string;
  /** Название цели; `null` — цель не выбрана. «Назад» — `kind: "return"`. */
  target: string | null;
  issues: FlowIssueCount;
}

/** Где узел в прогоне. */
export type FlowRunMark = "current" | "visited" | null;

export interface FlowStateNodeProps {
  stateId: string;
  title: string;
  /** Первая строка инструкции. */
  goal: string;
  exits: FlowExitRowView[];
  tags: string[];
  start: boolean;
  /** Без условий выхода — конец сценария. */
  final: boolean;
  noSideQuestions: boolean;
  /** «Длится» и свои касания одной строкой: «1 день · касания 15 мин · 1 ч»; пусто — нечего показать. */
  timing: string;
  selected: boolean;
  /** Приглушить: в прогоне или при выборе стрелки узел не участвует. */
  dimmed: boolean;
  run: FlowRunMark;
  issues: FlowIssueCount;
  /** Ручка входа доски: поставить на край карточки. */
  renderInputHandle(): ReactNode;
  /** Ручка выхода доски для строки условия. */
  renderExitHandle(exitId: string): ReactNode;
  onSelect(): void;
}

/** Legacy-компонент: с 0.76 общие переходы находятся в настройках, доска этот узел не рисует. */
export interface FlowAnyStateNodeProps {
  /** Названия состояний-исключений. */
  except: string[];
  exits: FlowExitRowView[];
  selected: boolean;
  dimmed: boolean;
  issues: FlowIssueCount;
  renderExitHandle(exitId: string): ReactNode;
  onSelect(): void;
}

export interface FlowEdgeProps {
  edgeId: string;
  kind: FlowEdgeKind;
  /** Путь SVG (`d`), посчитан доской. */
  path: string;
  /** Где поставить подпись, если скин её рисует. */
  labelX: number;
  labelY: number;
  label: string;
  selected: boolean;
  dimmed: boolean;
  /** Пройдена в прогоне. */
  traversed: boolean;
  onSelect(): void;
}

export interface FlowLegendProps {
  kinds: FlowEdgeKind[];
}

export interface FlowZoomControlsProps {
  /** 1 — как есть. */
  zoom: number;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
}

export interface FlowHeaderProps {
  name: string;
  onRename(name: string): void;
  mode: FlowEditorMode;
  onModeChange(mode: FlowEditorMode): void;
  issues: FlowIssueCount;
  onAddState(): void;
  onOpenCard(): void;
  onOpenJson(): void;
  /** Открыть отдельные настройки общих переходов (не узел доски). Доступно и в readOnly. */
  onOpenAnyState?(): void;
  /** Есть, если приложение передало `onSave`. */
  onSave?(): void;
  saving: boolean;
  dirty: boolean;
  /** Приложение отказало в сохранении (без исключения или с ним): вместо «Сохранено» показать отказ. */
  saveFailed?: boolean;
  /** Только просмотр: показать плашку, не давать добавлять состояния и переименовывать. */
  readOnly?: boolean;
  /** Есть, если приложение подключило перевод чатов и тестовый чат. */
  onOpenMigrate?(): void;
  onOpenTestChat?(): void;
  /** Узкая шапка: одна строка кнопок, без логотипа и названия сценария (приложение показывает своё). */
  compact?: boolean;
  /** Кнопка «На весь экран» / «Выйти»; нет — кнопки нет. */
  fullscreen?: { active: boolean; onToggle(): void };
}

/** Строка списка в обзоре и панелях: состояние, на которое можно перейти. */
export interface FlowStateLinkView {
  stateId: string;
  title: string;
  start: boolean;
  final: boolean;
  onSelect(): void;
}

export interface FlowOverviewPanelProps {
  name: string;
  /** «Общее для всех состояний». */
  common: string;
  onCommonChange(common: string): void;
  counts: { states: number; exits: number; finals: number };
  states: FlowStateLinkView[];
  issues: FlowIssueCount;
  /** Разделы «Дни и время» и «Попутные задачи» (части скина ниже); нет частей — пусто. */
  sections?: ReactNode;
}

/** Раздел «Дни и время» в обзоре. Редкое — в «Дополнительно». */
export interface FlowScheduleSectionProps {
  /** `null` — сценарий без дней. */
  schedule: FlowSchedule | null;
  /** Что делать с сообщением после конца разговора; поля нет — `reply`. */
  afterEnd: FlowAfterEnd;
  /** Куда перейти при «срок вышел». */
  states: FlowTargetOption[];
  /** Находки проверки по «Дням и времени». */
  issues: FlowIssue[];
  /** Касания по умолчанию: `FlowNudgesEditor`. */
  nudges: ReactNode;
  onToggle(on: boolean): void;
  onChange(patch: SchedulePatch): void;
  onAfterEndChange(mode: FlowAfterEnd): void;
}

/** Расписание касаний: ряд сроков тишины, потом время каждый день, срок «молчит — конец». */
export interface FlowNudgesEditorProps {
  /** `null` — касаний нет (только для общих касаний сценария). */
  nudges: FlowNudges | null;
  /** Можно выключить совсем: для общих касаний — да, у ноды за это отвечает режим. */
  optional: boolean;
  onChange(nudges: FlowNudges | null): void;
}

/** Раздел «Попутные задачи» в обзоре. */
export interface FlowSideTasksSectionProps {
  tasks: Array<FlowSideTask & { issues: FlowIssue[]; focused: boolean }>;
  /** Поля карточки и заметок, плюс поля приложения (`fromApp`), которых в сценарии ещё нет. */
  fields: Array<{ id: string; title: string; fromApp: boolean }>;
  /** Заданы «Дни и время»: есть встроенная задача «узнать город». */
  builtInCity: boolean;
  onAdd(): void;
  onChange(sideTaskId: string, patch: SideTaskPatch): void;
  onFieldChange(sideTaskId: string, fieldId: string | null): void;
  onDelete(sideTaskId: string): void;
}

/** «Длится» и «Касания» в панели ноды. */
export interface FlowStateTimingProps {
  /** Выход-продолжительность; `null` — не ограничено. */
  duration: { amount: number; unit: DurationUnit; to: string | null } | null;
  /** Дни и «до дня N программы» есть только при «Днях и времени»; иначе — часы. */
  daysAvailable: boolean;
  targets: FlowTargetOption[];
  /** Находки по выходу-продолжительности. */
  issues: FlowIssue[];
  onDurationChange(value: { amount: number; unit: DurationUnit } | null): void;
  onDurationTargetChange(to: string | null): void;
  nudgesMode: NudgesMode;
  onNudgesModeChange(mode: NudgesMode): void;
  /** Свои касания: `FlowNudgesEditor`; режим не «свои» — `null`. */
  nudges: ReactNode | null;
  /** Свои касания действуют столько дней, считая день входа; `null` — всё время в ноде. С 0.55. */
  nudgesDays: number | null;
  onNudgesDaysChange(days: number | null): void;
  /** Свои касания действуют до этого дня программы включительно; `null` — без такого предела. С 0.67. */
  nudgesUntilProgramDay: number | null;
  onNudgesUntilProgramDayChange(day: number | null): void;
}

/** Цель перехода в списке «Куда»: состояние или «назад». */
export interface FlowTargetOption {
  /** `id` состояния или `@return`. */
  value: string;
  title: string;
}

/** Карточка условия в панели состояния или общих переходов. */
export interface FlowExitCardProps {
  /** Читаемое правило общих переходов: условие → цель, локализовано слоем поведения. */
  summary?: string;
  exitId: string;
  when: FlowCondition;
  to: string | null;
  /** Поля карточки и заметок — для условия по данным. */
  fields: FlowField[];
  /** Какие сравнения подходят к выбранному полю. */
  ops: FlowDataOp[];
  /** Имена, объявленные приложением: кнопки и события, инструменты. */
  eventNames: { button: string[]; tool: string[]; app: string[] };
  /** Подписи кнопок и событий от приложения: имя → подпись. Нет подписи — показывать имя. С 0.55. */
  eventLabels?: Readonly<Record<string, string>>;
  targets: FlowTargetOption[];
  issues: FlowIssue[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange(next: { when: FlowCondition; to: string | null }): void;
  onMoveUp(): void;
  onMoveDown(): void;
  onDelete(): void;
}

export interface FlowStatePanelProps {
  stateId: string;
  title: string;
  instructions: string;
  firstMessage: string | null;
  learn: string[];
  tools: string[];
  tags: string[];
  start: boolean;
  noSideQuestions: boolean;
  /** Из чего выбирать «Узнать» и инструменты. */
  fields: FlowField[];
  catalogTools: string[];
  /** Карточки условий: скин кладёт их в раздел «Когда выходить и куда». */
  exits: ReactNode;
  /** «Длится» и «Касания» (`FlowStateTiming`); нет части скина — пусто. */
  timing?: ReactNode;
  issues: FlowIssue[];
  onChange(patch: {
    title?: string;
    instructions?: string;
    firstMessage?: string | null;
    learn?: string[];
    tools?: string[];
    tags?: string[];
    noSideQuestions?: boolean;
  }): void;
  onMakeStart(): void;
  onAddExit(kind: FlowConditionType): void;
  onDelete(): void;
}

export interface FlowAnyStatePanelProps {
  except: string[];
  states: FlowStateLinkView[];
  onExceptChange(stateIds: string[]): void;
  exits: ReactNode;
  onAddExit(kind: FlowConditionType): void;
}

/** Поле карточки или заметки в панели «Карточка и заметки». */
export interface FlowFieldRowProps {
  field: FlowField | ClientCardField;
  list: "clientCard" | "chatNotes";
  canMoveUp: boolean;
  canMoveDown: boolean;
  issues: FlowIssue[];
  onChange(patch: Partial<ClientCardField>): void;
  onMoveUp(): void;
  onMoveDown(): void;
  onDelete(): void;
}

export interface FlowCardPanelProps {
  /** Строки полей: `FlowFieldRow` по порядку. */
  clientCard: ReactNode;
  chatNotes: ReactNode;
  empty: boolean;
  sideQuestionEveryMessages: number;
  onPaceChange(messages: number): void;
  onAddField(list: "clientCard" | "chatNotes"): void;
  /** Поля словаря приложения (`catalog.fields`), которых в сценарии ещё нет. */
  appFields: Array<{ id: string; title: string }>;
  onAddAppField(list: "clientCard" | "chatNotes", fieldId: string): void;
}

export interface FlowCheckPanelProps {
  issues: Array<FlowIssue & { onGo(): void }>;
}

/** Выбор «что произошло» в прогоне: условие текущего состояния или общее. */
export interface FlowRunChoiceView {
  exitId: string;
  kind: FlowEdgeKind;
  text: string;
  target: string | null;
  onChoose(): void;
}

export interface FlowRunPanelProps {
  current: { stateId: string; title: string; goal: string };
  choices: FlowRunChoiceView[];
  onNothing(): void;
  /** Что агент знает: поле, значение строкой или `null`, устарело ли. */
  known: Array<{ fieldId: string; name: string; value: string | null; stale: boolean; onChange(value: string): void }>;
  /** Название поля, о котором агент спросит между делом; `null` — ни о чём. */
  nextQuestion: string | null;
  path: Array<{ stateId: string; title: string; via: string | null }>;
  canGoBack: boolean;
  onBack(): void;
  onRestart(): void;
  onFinish(): void;
}

export interface FlowJsonDialogProps {
  json: string;
  /** Ошибки разбора загруженного JSON, готовыми строками. */
  errors: string[];
  onCopy(): void;
  onDownload(): void;
  onLoad(text: string): void;
  onClose(): void;
  /** Только просмотр: JSON можно смотреть, копировать и скачивать, но не загружать. */
  readOnly?: boolean;
}

export interface FlowMigrateDialogProps {
  rows: Array<{
    versionId: string;
    stateId: string;
    stateTitle: string;
    chats: number;
    /** Состояния нет в новой версии: нужна цель. */
    removed: boolean;
    target: string | null;
    onTargetChange(stateId: string): void;
  }>;
  targets: FlowTargetOption[];
  busy: boolean;
  failed: boolean;
  /** Сколько перевели; `null` — ещё не переводили. */
  moved: number | null;
  canMigrate: boolean;
  onMigrate(): void;
  onClose(): void;
}

export interface FlowTestChatFrameProps {
  stateTitle: string;
  /** Сдвиг часов чата, готовой строкой («+1 ч 20 мин»). */
  clock: string;
  /** Варианты перемотки: подпись и сколько мс. */
  advanceSteps: Array<{ label: string; ms: number }>;
  onAdvance(ms: number): void;
  /** «День 2 из 3 · 14:20»; `null` — у сценария нет «Дней и времени» или ходов ещё не было. */
  day: string | null;
  /** К началу следующего дня сценария; нет — кнопки нет (нет «Дней и времени» или приложение не дало перемотку). */
  onNextDay?(): void;
  /** К моменту, когда сценарий сам напишет первым; нет — кнопки нет (приложение не дало перемотку). */
  onNextFirstMessage?(): void;
  /** Последняя перемотка к напоминанию не нашла, к чему перематывать: впереди сценарий сам ничего не напишет. */
  nothingScheduled?: boolean;
  /** Поле «своё время»: текст вроде «1 ч 30 мин»; `false` — не понял, перемотки не было. Нет — поля нет. */
  onAdvanceText?(text: string): boolean;
  /** Идёт запуск чата или перемотка: кнопки перемотки ждут. */
  busy: boolean;
  /** Чат не открылся или часы не перемотались. */
  failed: boolean;
  onReset(): void;
  onClose(): void;
  /** Сам чат (экран чата приложения); `null` — чат ещё создаётся. */
  children: ReactNode;
}

/** Раскладка редактора: шапка, доска и панель справа (`null` — панель закрыта). */
export interface FlowEditorFrameProps {
  header: ReactNode;
  board: ReactNode;
  panel: ReactNode | null;
  /** Окно поверх: JSON, перевод чатов, тестовый чат. */
  dialog: ReactNode | null;
  /** Класс и стиль корня, которые приложение передало в `FlowEditor`. Корень сам занимает высоту родителя, не меньше разумной. */
  className?: string;
  style?: CSSProperties;
  /** Шапка в одну узкую строку. */
  compact?: boolean;
}

/** Маленькая кнопка на доске или в шапке: свернуть и развернуть легенду, мини-карту, панель «Сценарий». */
export interface FlowBoardToggleProps {
  kind: "legend" | "minimap" | "inspector";
  /** Что сделает нажатие: «Показать мини-карту», «Скрыть панель «Сценарий»». */
  label: string;
  /** Показывается сейчас то, чем кнопка управляет. */
  expanded: boolean;
  /** С подписью рядом со значком (легенда), без неё — только значок. */
  showText?: boolean;
  onClick(): void;
}

/** Договор скина редактора сценария, версия 1. */
export interface FlowEditorSkin {
  FlowEditorFrame: ComponentType<FlowEditorFrameProps>;
  FlowHeader: ComponentType<FlowHeaderProps>;
  FlowStateNode: ComponentType<FlowStateNodeProps>;
  FlowAnyStateNode: ComponentType<FlowAnyStateNodeProps>;
  FlowEdge: ComponentType<FlowEdgeProps>;
  FlowLegend: ComponentType<FlowLegendProps>;
  FlowZoomControls: ComponentType<FlowZoomControlsProps>;
  FlowOverviewPanel: ComponentType<FlowOverviewPanelProps>;
  FlowStatePanel: ComponentType<FlowStatePanelProps>;
  FlowAnyStatePanel: ComponentType<FlowAnyStatePanelProps>;
  FlowExitCard: ComponentType<FlowExitCardProps>;
  FlowCardPanel: ComponentType<FlowCardPanelProps>;
  FlowFieldRow: ComponentType<FlowFieldRowProps>;
  FlowCheckPanel: ComponentType<FlowCheckPanelProps>;
  FlowRunPanel: ComponentType<FlowRunPanelProps>;
  FlowJsonDialog: ComponentType<FlowJsonDialogProps>;
  FlowMigrateDialog: ComponentType<FlowMigrateDialogProps>;
  FlowTestChatFrame: ComponentType<FlowTestChatFrameProps>;
  /** Кнопки места на доске. Нет — доска рисует простые кнопки на токенах `--flow-board-*`. */
  FlowBoardToggle?: ComponentType<FlowBoardToggleProps>;
  /** Части формата v2 (сценарии 0.49). Нет — разделов нет, остальное работает. */
  FlowScheduleSection?: ComponentType<FlowScheduleSectionProps>;
  FlowSideTasksSection?: ComponentType<FlowSideTasksSectionProps>;
  FlowStateTiming?: ComponentType<FlowStateTimingProps>;
  FlowNudgesEditor?: ComponentType<FlowNudgesEditorProps>;
}
