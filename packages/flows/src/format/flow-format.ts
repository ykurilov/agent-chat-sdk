/** Поле `format` у каждого сценария: по нему JSON узнаётся как сценарий агента. */
export const AGENT_FLOW_FORMAT = "agent-flow";

/** Версия формата, которую понимает этот SDK. Старые версии `parseFlow` переводит сам (`migrate-flow.ts`). */
export const AGENT_FLOW_FORMAT_VERSION = 2;

/** Особая цель перехода: вернуться в последнее основное состояние (после напоминаний и касаний). */
export const RETURN_TARGET = "@return";

/** Ключ места «Из любого состояния» в `layout`. */
export const ANY_STATE_LAYOUT_KEY = "@any";

/** `boolean` — «да/нет» (с версии 2): хранится `true` / `false`. */
export const FLOW_FIELD_TYPES = ["text", "number", "choice", "boolean"] as const;
export type FlowFieldType = (typeof FLOW_FIELD_TYPES)[number];

/** `ne` — «≠» (с версии 2), пока только для «да/нет». */
export const FLOW_DATA_OPS = ["filled", "eq", "ne", "gt", "lt", "contains"] as const;
export type FlowDataOp = (typeof FLOW_DATA_OPS)[number];

/** Какие сравнения подходят к типу поля. Остальные — ошибка проверки графа. */
export const FLOW_OPS_BY_FIELD_TYPE: Readonly<Record<FlowFieldType, readonly FlowDataOp[]>> = {
  text: ["filled", "contains"],
  number: ["filled", "eq", "gt", "lt"],
  choice: ["filled", "eq"],
  boolean: ["filled", "eq", "ne"],
};

export const FLOW_EVENT_TYPES = ["message", "button", "tool", "app"] as const;
export type FlowEventType = (typeof FLOW_EVENT_TYPES)[number];

export const FLOW_TIMER_UNITS = ["min", "h", "d"] as const;
export type FlowTimerUnit = (typeof FLOW_TIMER_UNITS)[number];

/** Откуда считается срок: время в состоянии, тишина человека, с начала чата. */
export const FLOW_TIMER_SPANS = ["in_state", "silence", "since_start"] as const;
export type FlowTimerSpan = (typeof FLOW_TIMER_SPANS)[number];

/** Заметка чата: живёт весь чат, в следующем чате не помнится. */
export interface FlowField {
  id: string;
  name: string;
  /** Что это и когда уместно спросить. Видит модель. */
  about: string;
  type: FlowFieldType;
  /** Варианты для `choice`; у остальных типов пусто. */
  options: string[];
}

/** Поле карточки клиента: долгая память о человеке, переживает чаты. */
export interface ClientCardField extends FlowField {
  /** Через сколько месяцев мягко уточнить; `null` — не устаревает. */
  refreshAfterMonths: number | null;
}

/** Условие словами: решает судья по разговору. */
export interface JudgeCondition {
  type: "judge";
  text: string;
}

/** Условие по данным: поле карточки или заметки чата. При `filled` значения нет; у «да/нет» значение — `true` / `false`. */
export interface DataCondition {
  type: "data";
  field: string;
  op: FlowDataOp;
  value?: string | number | boolean;
}

/** Событие: сообщение человека, кнопка, вызов инструмента или событие приложения — по именам, которые объявило приложение. */
export interface EventCondition {
  type: "event";
  event: FlowEventType;
  name?: string;
}

export interface SpanTimerCondition {
  type: "timer";
  from: FlowTimerSpan;
  amount: number;
  unit: FlowTimerUnit;
}

/** Наступило время суток (в поясе человека), `at` — «ЧЧ:ММ». */
export interface TimeOfDayTimerCondition {
  type: "timer";
  from: "time_of_day";
  at: string;
}

/** Нода длится `days` дней сценария: срок — начало дня «день входа + days» (`schedule.dayStart`). С версии 2. */
export interface StateDaysTimerCondition {
  type: "timer";
  from: "state_days";
  days: number;
}

/**
 * Наступил день `day` сценария: начало этого дня (`schedule.dayStart`) по часам человека, по той же нумерации, что день в
 * `readRun`. Нода вошла в день `day` или позже — выход сразу. Дополнение к версии 2 (0.55).
 */
export interface ProgramDayTimerCondition {
  type: "timer";
  from: "program_day";
  day: number;
}

export type TimerCondition = SpanTimerCondition | TimeOfDayTimerCondition | StateDaysTimerCondition | ProgramDayTimerCondition;
export type FlowCondition = JudgeCondition | DataCondition | EventCondition | TimerCondition;
export type FlowConditionType = FlowCondition["type"];

export interface FlowExit {
  /** Постоянный адрес условия: на него ссылаются история переходов и таймеры. */
  id: string;
  when: FlowCondition;
  /** `id` состояния или `RETURN_TARGET`; `null` — цель ещё не выбрана. */
  to: string | null;
}

export interface FlowState {
  id: string;
  /** Зарезервировано под подсценарии. */
  kind: "state";
  title: string;
  /** Первая строка — цель (её видно на доске), дальше — как себя вести. */
  instructions: string;
  /** Что написать при входе в состояние; `null` — агент пишет сам. */
  firstMessage: string | null;
  /** Поля карточки и заметок, которые нужно узнать здесь. */
  learn: string[];
  /** Не задавать вопросов между делом. */
  noSideQuestions: boolean;
  /** Инструменты приложения, доступные в этом состоянии. */
  tools: string[];
  /** Метки перехода в это состояние: приходят в `onTransition`. */
  tags: string[];
  /** Состояние без условий — конец сценария. */
  exits: FlowExit[];
  /** Свои касания ноды; `"off"` — без касаний; нет — общие `schedule.nudges`, затем `nudges` сценария. С версии 2. */
  nudges?: FlowStateNudges | "off";
}

/** Общие переходы: работают из любого состояния, кроме перечисленных. */
export interface FlowAnyState {
  except: string[];
  exits: FlowExit[];
}

export interface FlowPace {
  /** Как часто можно спросить между делом: раз в столько сообщений человека. */
  sideQuestionEveryMessages: number;
}

export interface FlowPoint {
  x: number;
  y: number;
}

/** Срок словами формата: «15 min», «4 h», «3 d» (d = 24 ч). */
export interface FlowDuration {
  amount: number;
  unit: FlowTimerUnit;
}

/** Касания — ход агента в той же ноде, когда человек молчит. И у сценария, и у ноды. */
export interface FlowNudges {
  /** Ряд сроков тишины от последнего ответа агента; сообщение человека начинает ряд сначала. */
  afterSilence: FlowDuration[];
  /** После ряда — касания в эти часы («ЧЧ:ММ») каждый день. */
  dailyAt?: string[];
  /** Столько тишины — конец разговора «не завершил», без сообщения. */
  giveUpAfter?: FlowDuration;
}

/** Свои касания ноды: можно ограничить первыми днями в ноде. */
export interface FlowStateNudges extends FlowNudges {
  /**
   * Свой ряд действует столько дней сценария, считая день входа в ноду (1 — только день входа). Потом — общие касания
   * (`schedule.nudges`, затем `nudges` сценария), их ряд с начала. Нет — всё время в ноде. С 0.55.
   */
  days?: number;
}

/** Порог позднего старта по умолчанию: до ночи меньше 3 ч — первым днём считается завтра. */
export const DEFAULT_LATE_START_HOURS = 3;

/** «Дни и время»: дни сценария, ночь, срок, касания, рамки дня. С версии 2. */
export interface FlowSchedule {
  /** Начало дня, оно же утреннее касание: «09:00». */
  dayStart: string;
  /** Начало ночи: ночь = [nightFrom, dayStart). Нет — ночь из настроек приложения. */
  nightFrom?: string;
  /** Пришёл позже, чем за столько часов до ночи, — первый день завтра. 0 — день старта всегда первый. */
  lateStartHours: number;
  /** Общий срок в днях, 1–60. */
  lengthDays?: number;
  /** Куда перейти при «срок вышел» перед концом. */
  deadlineState?: string;
  /** При «срок вышел» агент пишет одно прощальное сообщение по правилам «писать первым» (→ В5). */
  farewellOnDeadline: boolean;
  /** Готовый текст прощания: уходит слово в слово, без модели. Нет — прощание пишет модель. */
  farewellText?: string;
  firstMessages?: {
    /** Нет — из настроек приложения. */
    maxPerDay?: number;
    /** Писать в начале дня; нет — да, если задан `lengthDays`. */
    morning?: boolean;
    /** Утреннее пропускается, если человек писал за столько минут до него; нет — 180. */
    skipMorningIfHumanWithinMin?: number;
  };
  /** Общее правило касаний. */
  nudges?: FlowNudges;
  /** Рамки дня по числу сообщений человека: мягкая с `softFrom`, жёсткая на `hardAt`. */
  dayFrame?: { softFrom?: number; hardAt?: number; hardText?: string };
}

/** Попытки попутной задачи по умолчанию. */
export const DEFAULT_SIDE_TASK_MAX_ATTEMPTS = 2;

/** Попутная задача: агент делает её между делом, в общем темпе вопросов между делом. С версии 2. */
export interface FlowSideTask {
  id: string;
  /** Что сделать, словами для агента. */
  text: string;
  /** Когда уместно, словами. */
  when?: string;
  /** Поле карточки или заметки: задача решена, когда оно известно. */
  field?: string;
  maxAttempts: number;
  /** Попытки считаются в каждом разговоре заново; иначе — на человека. */
  perConversation: boolean;
}

/** Что делать с сообщением человека после конца разговора (→ В6): `reply` — агент отвечает по общей части, `silent` — молчит. */
export const FLOW_AFTER_END_MODES = ["reply", "silent"] as const;
export type FlowAfterEnd = (typeof FLOW_AFTER_END_MODES)[number];

/** Сценарий поведения агента после `parseFlow`: все значения по умолчанию на месте. */
export interface AgentFlow {
  format: typeof AGENT_FLOW_FORMAT;
  version: typeof AGENT_FLOW_FORMAT_VERSION;
  id: string;
  name: string;
  /** Начальное состояние; `null` — не выбрано (ошибка проверки графа). */
  start: string | null;
  /** Общее для всех состояний: роль, тон, цены, условия, ссылки. */
  common: string;
  pace: FlowPace;
  clientCard: ClientCardField[];
  chatNotes: FlowField[];
  /** Имена инструментов приложения, которыми пользуется сценарий. */
  tools: string[];
  anyState: FlowAnyState;
  states: FlowState[];
  /** Места на доске по `id` состояния (и `ANY_STATE_LAYOUT_KEY`). Движок их не читает. */
  layout: Record<string, FlowPoint>;
  /** «Дни и время». Нет — сценарий без дней, как в версии 1. */
  schedule?: FlowSchedule;
  /**
   * Касания на весь сценарий без «Дней и времени» (0.50): нодам без своих касаний. Есть `schedule.nudges` — действуют
   * они. Нет — как в 0.49.
   */
  nudges?: FlowNudges;
  /** Попутные задачи. */
  sideTasks?: FlowSideTask[];
  /**
   * После конца разговора (→ В6). Нет — `reply`. Задан он или «Дни и время» — вход в конечную ноду закрывает разговор;
   * иначе, как в 0.48, конечная нода только сообщает `onFinish`.
   */
  afterEnd?: FlowAfterEnd;
}

export interface FlowFormatError {
  /** Место в JSON: `states[0].exits[1].when.amount`. Пусто — весь документ. */
  path: string;
  message: string;
}

export type ParseFlowResult = { ok: true; flow: AgentFlow } | { ok: false; errors: FlowFormatError[] };

/** Что объявило приложение: по этим именам сценарий ссылается на инструменты, события и виджеты. */
export interface FlowCatalog {
  tools: readonly string[];
  /** Кнопки и события приложения: имя или `{ name, label }` — подпись видна на доске вместо имени. */
  events: readonly FlowCatalogEvent[];
  widgets: readonly string[];
  /** Словарь полей приложения: редактор предлагает их в карточке, заметках и попутных задачах. */
  fields?: readonly FlowCatalogField[];
}

/** Кнопка или событие приложения: просто имя или имя с подписью для доски («paid» → «Оплачено»). Объект — с 0.55. */
export type FlowCatalogEvent = string | { name: string; label?: string };

/** Поле из словаря приложения. */
export interface FlowCatalogField {
  id: string;
  title: string;
  type: FlowFieldType;
  options?: readonly string[];
}

/** Ошибка не даёт запустить сценарий, замечание — подсказка автору. */
export type FlowIssueLevel = "error" | "warning";

/** Находка `checkFlow`: одна и та же в редакторе и при загрузке сценария на сервере. */
export interface FlowIssue {
  level: FlowIssueLevel;
  /** Постоянный код находки, например `unreachable_state`. */
  code: string;
  message: string;
  /** Где показать: состояние, условие, поле, попутная задача. */
  place: { stateId?: string; exitId?: string; fieldId?: string; sideTaskId?: string };
}
