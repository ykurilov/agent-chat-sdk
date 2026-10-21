import type { FlowConditionType, FlowDataOp, FlowEventType, FlowFieldType, FlowTimerSpan, FlowTimerUnit } from "../format/flow-format";

/** Надписи редактора сценария: доска, шапка, панели, прогон, окно JSON. */
export interface FlowEditorLabels {
  conditionKinds: Record<FlowConditionType, string>;
  /** Подсказка к виду условия в легенде. */
  conditionKindHints: Record<FlowConditionType, string>;
  returnKind: string;
  returnTarget: string;
  ops: Record<FlowDataOp, string>;
  events: Record<FlowEventType, string>;
  timerSpans: Record<FlowTimerSpan | "time_of_day", string>;
  units: Record<FlowTimerUnit, string>;
  fieldTypes: Record<FlowFieldType, string>;
  /** Значения поля «да/нет» в условиях и подписях. */
  yes: string;
  no: string;
  /** «1 день», «3 дня», «5 дней». */
  days: (count: number) => string;
  /** Подпись условия «наступил день N программы» на доске: «с дня 3». */
  programDay: (day: number) => string;

  header: {
    state: string;
    card: string;
    check: string;
    run: string;
    json: string;
    save: string;
    saved: string;
    unsaved: string;
    /** Сохранение отклонено: приложение отказало или упало. */
    saveFailed: string;
    saveFailedHint: string;
    /** Плашка «только просмотр»: сценарий сейчас правит не человек. */
    readOnly: string;
    readOnlyHint: string;
    migrate: string;
    /** Меню «⋯» шапки на узком экране: подпись кнопки. */
    more: string;
  };
  board: {
    anyState: string;
    start: string;
    final: string;
    noSideQuestions: string;
    noTarget: string;
    /** Условие словами, у которого ещё нет текста. */
    emptyCondition: string;
    /** Название нового состояния. */
    newState: string;
    zoomIn: string;
    zoomOut: string;
    fit: string;
    /** «2 ошибки», «1 замечание». */
    errors: (count: number) => string;
    warnings: (count: number) => string;
    /** Подпись касаний на карточке ноды: «касания 15 мин · 1 ч». */
    nudges: string;
    noNudges: string;
    /** Срок своих касаний на карточке: «в день входа», «первые 2 дн.». */
    nudgesDays: (days: number) => string;
    nudgesUntilProgramDay: (day: number) => string;
    /** Кнопки места на доске: легенда, мини-карта, панель «Сценарий», полный экран. */
    space: {
      legend: string;
      showMinimap: string;
      hideMinimap: string;
      showInspector: string;
      hideInspector: string;
      enterFullscreen: string;
      exitFullscreen: string;
      /** Подпись области редактора в полном экране. */
      fullscreenRegion: string;
    };
  };
  overview: {
    title: string;
    common: string;
    commonHint: string;
    states: string;
    exits: string;
    finals: string;
    lists: string;
    help: string;
    /** Находки без места: весь сценарий, «Дни и время». */
    flowIssues: string;
    afterEnd: string;
    afterEndModes: Record<"reply" | "silent", string>;
    afterEndHints: Record<"reply" | "silent", string>;
  };
  schedule: {
    title: string;
    on: string;
    hint: string;
    dayStart: string;
    dayStartHint: string;
    lengthDays: string;
    lengthDaysNone: string;
    nightFrom: string;
    nightFromHint: string;
    lateStart: string;
    lateStartHint: string;
    deadlineState: string;
    deadlineNone: string;
    farewell: string;
    farewellText: string;
    farewellTextHint: string;
    firstMessages: string;
    maxPerDay: string;
    maxPerDayHint: string;
    maxPerDayByDay: string;
    maxPerDayByDayHint: string;
    morning: string;
    skipMorning: string;
    nudges: string;
    nudgesHint: string;
    dayFrame: string;
    dayFrameHint: string;
    softFrom: string;
    hardAt: string;
    hardText: string;
    hardTextHint: string;
    more: string;
  };
  nudges: {
    afterSilence: string;
    addStep: string;
    dailyAt: string;
    addTime: string;
    giveUpAfter: string;
    never: string;
    remove: string;
    on: string;
  };
  sideTasks: {
    title: string;
    hint: string;
    builtIn: string;
    text: string;
    when: string;
    field: string;
    noField: string;
    fromApp: string;
    maxAttempts: string;
    perConversation: string;
    add: string;
    newTask: string;
    delete: string;
  };
  statePanel: {
    title: string;
    name: string;
    instructions: string;
    instructionsHint: string;
    firstMessage: string;
    learn: string;
    tools: string;
    toolsHint: string;
    noTools: string;
    tags: string;
    makeStart: string;
    isStart: string;
    noSideQuestions: string;
    exits: string;
    addExit: string;
    more: string;
    deleteState: string;
    /** «Длится»: выход по времени в ноде. */
    duration: string;
    durationHint: string;
    durationNone: string;
    durationUnits: Record<"h" | "d" | "program_day", string>;
    durationTo: string;
    nudges: string;
    nudgesModes: Record<"inherit" | "own" | "off", string>;
    nudgesHint: string;
    /** Сколько действуют свои касания: всё время в ноде или N дней с дня входа. */
    nudgesDays: string;
    nudgesDaysModes: Record<"always" | "days" | "untilProgramDay", string>;
    nudgesDaysHint: string;
    nudgesUntilProgramDayHint: string;
  };
  exitCard: {
    when: string;
    field: string;
    op: string;
    value: string;
    event: string;
    eventName: string;
    timer: string;
    amount: string;
    at: string;
    to: string;
    moveUp: string;
    moveDown: string;
    delete: string;
  };
  anyStatePanel: {
    title: string;
    hint: string;
    except: string;
  };
  cardPanel: {
    title: string;
    clientCard: string;
    chatNotes: string;
    chatNotesHint: string;
    empty: string;
    name: string;
    about: string;
    type: string;
    options: string;
    optionsHint: string;
    refreshAfter: string;
    /** «через 6 мес.». */
    refreshAfterMonths: (months: number) => string;
    pace: string;
    /** «раз в 5 сообщений». */
    paceEvery: (messages: number) => string;
    paceHint: string;
    addField: string;
    newField: string;
    /** Добавить поле из словаря приложения (`catalog.fields`). */
    fromApp: string;
  };
  checkPanel: {
    title: string;
    clean: string;
    errors: string;
    warnings: string;
    goTo: string;
    /** Проверки приложения упали. */
    appCheckFailed: string;
  };
  runPanel: {
    title: string;
    hint: string;
    current: string;
    whatHappened: string;
    nothing: string;
    known: string;
    notYet: string;
    nextQuestion: string;
    path: string;
    back: string;
    restart: string;
    finish: string;
    /** «Прогон · шаг 3». */
    step: (step: number) => string;
    /** Цель выбора «ничего из этого». */
    stay: string;
    /** Выбор, который сейчас не сработает: нет цели или «назад» некуда. */
    wontFire: string;
    /** Шаг пути, когда ничего не сработало. */
    nothingHappened: string;
    noStart: string;
  };
  jsonDialog: {
    title: string;
    copy: string;
    copied: string;
    download: string;
    load: string;
    close: string;
  };
}

export const russianFlowEditorLabels: FlowEditorLabels = {
  conditionKinds: { judge: "Словами", data: "Данные", event: "Событие", timer: "Таймер" },
  conditionKindHints: {
    judge: "Словами — решает агент, проверяет судья",
    data: "По данным — поле заполнено, значение равно…",
    event: "Событие — кнопка, инструмент, сигнал приложения",
    timer: "Таймер — по часам",
  },
  returnKind: "Назад",
  returnTarget: "назад, где был",
  ops: { filled: "заполнено", eq: "=", ne: "≠", gt: ">", lt: "<", contains: "содержит" },
  events: { message: "Пришло сообщение", button: "Нажата кнопка", tool: "Вызван инструмент", app: "Событие приложения" },
  timerSpans: {
    in_state: "Время в этом состоянии",
    silence: "Тишина человека",
    since_start: "Прошло с начала чата",
    time_of_day: "Наступило время суток",
  },
  units: { min: "мин", h: "ч", d: "дн." },
  fieldTypes: { text: "Текст", number: "Число", choice: "Выбор", boolean: "Да/нет" },
  yes: "да",
  no: "нет",
  days: (count) => {
    const tens = count % 100;
    const ones = count % 10;
    const word = tens >= 11 && tens <= 14 ? "дней" : ones === 1 ? "день" : ones >= 2 && ones <= 4 ? "дня" : "дней";
    return `${count} ${word}`;
  },
  programDay: (day) => `с дня ${day}`,

  header: {
    state: "Состояние",
    card: "Карточка и заметки",
    check: "Проверить граф",
    run: "Прогон",
    json: "JSON",
    save: "Сохранить",
    saved: "Сохранено",
    unsaved: "Есть несохранённые правки",
    saveFailed: "Не сохранено",
    saveFailedHint: "Сохранение отклонено. Что не так — в «Проверить граф» и на нодах.",
    readOnly: "Только просмотр",
    readOnlyHint: "Сценарий сейчас правит агент. Смотреть и прогонять можно, править нельзя.",
    migrate: "Перевести чаты",
    more: "Ещё действия",
  },
  board: {
    anyState: "Из любого состояния",
    start: "Сценарий начинается здесь",
    final: "Конец",
    noSideQuestions: "Без вопросов о человеке",
    noTarget: "куда — не выбрано",
    emptyCondition: "условие не написано",
    newState: "Новое состояние",
    zoomIn: "Крупнее",
    zoomOut: "Мельче",
    fit: "Весь граф",
    errors: (count) => `Ошибок: ${count}`,
    warnings: (count) => `Замечаний: ${count}`,
    nudges: "касания",
    noNudges: "без касаний",
    nudgesDays: (days) => (days === 1 ? "в день входа" : `первые ${days} дн.`),
    nudgesUntilProgramDay: (day) => `до дня ${day} программы`,
    space: {
      legend: "Легенда",
      showMinimap: "Показать мини-карту",
      hideMinimap: "Скрыть мини-карту",
      showInspector: "Показать панель «Сценарий»",
      hideInspector: "Скрыть панель «Сценарий»",
      enterFullscreen: "На весь экран",
      exitFullscreen: "Выйти из полного экрана",
      fullscreenRegion: "Редактор сценария на весь экран",
    },
  },
  overview: {
    title: "Сценарий",
    common: "Общее для всех состояний",
    commonHint: "Роль, тон, цены, условия, ссылки — то, что верно в любом состоянии.",
    states: "Состояний",
    exits: "Условий выхода",
    finals: "Конечных",
    lists: "Списки",
    help: "Как пользоваться",
    flowIssues: "Весь сценарий",
    afterEnd: "После конца разговора",
    afterEndModes: { reply: "Отвечать", silent: "Не отвечать" },
    afterEndHints: {
      reply: "Агент отвечает по общей части: знает, что программа закончилась, не ведёт по шагам и не продаёт повторно.",
      silent: "Агент молчит, сообщение получает приложение.",
    },
  },
  schedule: {
    title: "Дни и время",
    on: "Сценарий по дням",
    hint: "Дни, ночь, общий срок и сообщения первым. Номер дня агент видит в каждом ходе.",
    dayStart: "Начало дня",
    dayStartHint: "В это время — утреннее сообщение.",
    lengthDays: "Сколько дней",
    lengthDaysNone: "без срока",
    nightFrom: "Ночь с",
    nightFromHint: "Ночью агент первым не пишет. Пусто — как в настройках приложения.",
    lateStart: "Поздний старт, ч",
    lateStartHint: "Пришёл меньше чем за столько часов до ночи — первый день завтра. 0 — день прихода первый.",
    deadlineState: "Срок вышел — перейти в",
    deadlineNone: "сразу закончить",
    farewell: "Попрощаться, когда срок вышел",
    farewellText: "Готовый текст прощания",
    farewellTextHint: "Пусто — прощание напишет агент.",
    firstMessages: "Сообщения первым",
    maxPerDay: "Не больше в день",
    maxPerDayHint: "Пусто — как в настройках приложения.",
    maxPerDayByDay: "Не больше в день по дням программы",
    maxPerDayByDayHint: "Через запятую: «3, 2» — в день 1 три, со дня 2 по два. Главнее поля выше. Ответ человека счёт не обнуляет.",
    morning: "Утреннее сообщение",
    skipMorning: "Не писать утром, если человек писал за, мин",
    nudges: "Касания по умолчанию",
    nudgesHint: "Агент пишет в той же ноде, когда человек молчит. У ноды можно задать свои.",
    dayFrame: "Рамки дня",
    dayFrameHint: "По числу сообщений человека за день.",
    softFrom: "Сворачивать с сообщения №",
    hardAt: "Закончить день на сообщении №",
    hardText: "Ответ, когда день закончен",
    hardTextHint: "Уходит слово в слово, без модели.",
    more: "Дополнительно",
  },
  nudges: {
    afterSilence: "Молчит — написать через",
    addStep: "Добавить срок",
    dailyAt: "Потом каждый день в",
    addTime: "Добавить время",
    giveUpAfter: "Молчит столько — разговор окончен",
    never: "никогда",
    remove: "Убрать",
    on: "Касания по умолчанию",
  },
  sideTasks: {
    title: "Попутные задачи",
    hint: "Агент делает их между делом, в темпе вопросов о человеке. Не больше заданных попыток.",
    builtIn: "«Узнать город» — встроенная задача: есть всегда, когда заданы «Дни и время».",
    text: "Что сделать",
    when: "Когда уместно",
    field: "Решена, когда известно поле",
    noField: "—",
    fromApp: "Поля приложения",
    maxAttempts: "Попыток",
    perConversation: "Заново в каждом разговоре",
    add: "Добавить задачу",
    newTask: "",
    delete: "Удалить задачу",
  },
  statePanel: {
    title: "Состояние",
    name: "Название",
    instructions: "Что агент здесь делает",
    instructionsHint: "Первая строка — цель, её видно на доске. Дальше — как себя вести.",
    firstMessage: "Первое сообщение",
    learn: "Узнать в этом состоянии",
    tools: "Инструменты",
    toolsHint: "Агенту здесь доступны только отмеченные.",
    noTools: "В сценарии пока нет инструментов.",
    tags: "Метки",
    makeStart: "Начинать отсюда",
    isStart: "Сценарий начинается здесь",
    noSideQuestions: "Не спрашивать здесь о человеке между делом",
    exits: "Когда выходить и куда",
    addExit: "Добавить условие",
    more: "Дополнительно",
    deleteState: "Удалить состояние",
    duration: "Длится",
    durationHint: "Потом переход «Куда». Дни — дни сценария: новый день начинается в начале дня. «До дня программы» — до начала этого дня, когда бы человек ни пришёл в ноду.",
    durationNone: "не ограничено",
    durationUnits: { h: "часов", d: "дней", program_day: "до дня программы" },
    durationTo: "Потом — куда",
    nudges: "Касания",
    nudgesModes: { inherit: "Как у сценария", own: "Свои", off: "Выкл" },
    nudgesHint: "Агент пишет здесь сам, когда человек молчит.",
    nudgesDays: "Свои касания действуют",
    nudgesDaysModes: { always: "всё время в ноде", days: "дн., считая день входа", untilProgramDay: "до дня программы включительно" },
    nudgesDaysHint: "Потом — касания сценария: утреннее и общий ряд с начала.",
    nudgesUntilProgramDayHint: "Пришёл в ноду позже — своих касаний нет, сразу касания сценария.",
  },
  exitCard: {
    when: "Когда",
    field: "Поле",
    op: "Как сравнить",
    value: "Значение",
    event: "Событие",
    eventName: "Что именно",
    timer: "Откуда считать",
    amount: "Сколько",
    at: "Во сколько",
    to: "Куда",
    moveUp: "Выше",
    moveDown: "Ниже",
    delete: "Удалить условие",
  },
  anyStatePanel: {
    title: "Общие переходы",
    hint: "Работают из любого состояния. Свои условия состояния проверяются раньше.",
    except: "Не действуют ещё и здесь",
  },
  cardPanel: {
    title: "Карточка и заметки",
    clientCard: "Карточка клиента",
    chatNotes: "Заметки этого чата",
    chatNotesHint: "Живут весь чат, в следующем чате не помнятся.",
    empty: "Карточка клиента и заметки пока пусты.",
    name: "Название",
    about: "Что это и когда уместно спросить",
    type: "Тип",
    options: "Варианты",
    optionsHint: "Варианты через запятую",
    refreshAfter: "Может устареть",
    refreshAfterMonths: (months) => `через ${months} мес.`,
    pace: "Вопрос о человеке — раз в",
    paceEvery: (messages) => `раз в ${messages} сообщений`,
    paceHint: "Сначала пытается понять из слов, спрашивает — если не вышло. Не спрашивает, если человек раздражён или торопится.",
    addField: "Добавить поле",
    newField: "Новое поле",
    fromApp: "Поле приложения…",
  },
  checkPanel: {
    title: "Проверка",
    clean: "Проблем не нашлось.",
    errors: "Ошибки",
    warnings: "Замечания",
    goTo: "Открыть",
    appCheckFailed: "Проверки приложения не сработали — их находок здесь нет",
  },
  runPanel: {
    title: "Прогон",
    hint: "Прогон: выбирайте справа, что произошло",
    current: "Где сейчас агент",
    whatHappened: "Что произошло?",
    nothing: "Ничего из этого",
    known: "Что агент знает",
    notYet: "Пока нет",
    nextQuestion: "Следующий вопрос о человеке",
    path: "Пройденный путь",
    back: "Шаг назад",
    restart: "Сначала",
    finish: "Закончить прогон",
    step: (step) => `Прогон · шаг ${step}`,
    stay: "остаться здесь",
    wontFire: "сейчас не сработает",
    nothingHappened: "ничего не сработало",
    noStart: "Нет стартового состояния: отметьте, где начинается сценарий",
  },
  jsonDialog: {
    title: "Граф в формате JSON",
    copy: "Копировать",
    copied: "Скопировано",
    download: "Скачать",
    load: "Загрузить",
    close: "Закрыть",
  },
};

export const englishFlowEditorLabels: FlowEditorLabels = {
  conditionKinds: { judge: "In words", data: "Data", event: "Event", timer: "Timer" },
  conditionKindHints: {
    judge: "In words — the agent decides, the judge checks",
    data: "By data — a field is filled, a value equals…",
    event: "Event — a button, a tool, an app signal",
    timer: "Timer — by the clock",
  },
  returnKind: "Back",
  returnTarget: "back where it was",
  ops: { filled: "is filled", eq: "=", ne: "≠", gt: ">", lt: "<", contains: "contains" },
  events: { message: "Message arrived", button: "Button pressed", tool: "Tool called", app: "App event" },
  timerSpans: {
    in_state: "Time in this state",
    silence: "Person is silent",
    since_start: "Since the chat started",
    time_of_day: "Time of day reached",
  },
  units: { min: "min", h: "h", d: "d" },
  fieldTypes: { text: "Text", number: "Number", choice: "Choice", boolean: "Yes/no" },
  yes: "yes",
  no: "no",
  days: (count) => `${count} ${count === 1 ? "day" : "days"}`,
  programDay: (day) => `from day ${day}`,

  header: {
    state: "State",
    card: "Card and notes",
    check: "Check the graph",
    run: "Dry run",
    json: "JSON",
    save: "Save",
    saved: "Saved",
    unsaved: "Unsaved changes",
    saveFailed: "Not saved",
    saveFailedHint: "Saving was rejected. See what is wrong in “Check flow” and on the nodes.",
    readOnly: "View only",
    readOnlyHint: "An agent is editing this flow right now. You can look and run it, but not edit.",
    migrate: "Move chats",
    more: "More actions",
  },
  board: {
    anyState: "From any state",
    start: "The flow starts here",
    final: "End",
    noSideQuestions: "No questions about the person",
    noTarget: "target not chosen",
    emptyCondition: "condition not written",
    newState: "New state",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fit: "Whole graph",
    errors: (count) => `Errors: ${count}`,
    warnings: (count) => `Warnings: ${count}`,
    nudges: "nudges",
    noNudges: "no nudges",
    nudgesDays: (days) => (days === 1 ? "on the entry day" : `for the first ${days} days`),
    nudgesUntilProgramDay: (day) => `until program day ${day}`,
    space: {
      legend: "Legend",
      showMinimap: "Show the minimap",
      hideMinimap: "Hide the minimap",
      showInspector: "Show the flow panel",
      hideInspector: "Hide the flow panel",
      enterFullscreen: "Full screen",
      exitFullscreen: "Exit full screen",
      fullscreenRegion: "Flow editor, full screen",
    },
  },
  overview: {
    title: "Flow",
    common: "Common to all states",
    commonHint: "Role, tone, prices, terms, links — whatever holds in every state.",
    states: "States",
    exits: "Exit conditions",
    finals: "Final",
    lists: "Lists",
    help: "How to use",
    flowIssues: "Whole flow",
    afterEnd: "After the conversation ends",
    afterEndModes: { reply: "Reply", silent: "Stay silent" },
    afterEndHints: {
      reply: "The agent replies from the common part: it knows the program is over, does not lead through steps or sell again.",
      silent: "The agent stays silent; the app receives the message.",
    },
  },
  schedule: {
    title: "Days and time",
    on: "Day-by-day flow",
    hint: "Days, night, total length and first messages. The agent sees the day number on every turn.",
    dayStart: "Day starts at",
    dayStartHint: "The morning message goes out at this time.",
    lengthDays: "How many days",
    lengthDaysNone: "no limit",
    nightFrom: "Night from",
    nightFromHint: "At night the agent never writes first. Empty — as in the app settings.",
    lateStart: "Late start, h",
    lateStartHint: "Arrived less than this many hours before night — day one is tomorrow. 0 — the arrival day is day one.",
    deadlineState: "Time is up — go to",
    deadlineNone: "end right away",
    farewell: "Say goodbye when time is up",
    farewellText: "Ready-made goodbye",
    farewellTextHint: "Empty — the agent writes the goodbye.",
    firstMessages: "Writing first",
    maxPerDay: "At most per day",
    maxPerDayHint: "Empty — as in the app settings.",
    maxPerDayByDay: "At most per day, by program day",
    maxPerDayByDayHint: "Comma-separated: “3, 2” — three on day 1, two from day 2 on. Overrides the field above. A reply doesn't reset the count.",
    morning: "Morning message",
    skipMorning: "Skip the morning if the person wrote within, min",
    nudges: "Default nudges",
    nudgesHint: "The agent writes in the same state while the person is silent. A state can have its own.",
    dayFrame: "Daily limits",
    dayFrameHint: "By the number of the person's messages per day.",
    softFrom: "Wrap up from message #",
    hardAt: "End the day at message #",
    hardText: "Reply when the day is over",
    hardTextHint: "Sent word for word, without the model.",
    more: "More",
  },
  nudges: {
    afterSilence: "Silent — write after",
    addStep: "Add a delay",
    dailyAt: "Then every day at",
    addTime: "Add a time",
    giveUpAfter: "Silent this long — conversation over",
    never: "never",
    remove: "Remove",
    on: "Default nudges",
  },
  sideTasks: {
    title: "Side tasks",
    hint: "The agent does them in passing, at the pace of questions about the person. No more than the given attempts.",
    builtIn: "“Find out the city” is built in: always on when “Days and time” are set.",
    text: "What to do",
    when: "When it fits",
    field: "Done when this field is known",
    noField: "—",
    fromApp: "App fields",
    maxAttempts: "Attempts",
    perConversation: "Anew in every conversation",
    add: "Add a task",
    newTask: "",
    delete: "Delete the task",
  },
  statePanel: {
    title: "State",
    name: "Name",
    instructions: "What the agent does here",
    instructionsHint: "The first line is the goal, shown on the board. Then — how to behave.",
    firstMessage: "First message",
    learn: "Learn in this state",
    tools: "Tools",
    toolsHint: "Only the checked tools are available here.",
    noTools: "The flow has no tools yet.",
    tags: "Tags",
    makeStart: "Start here",
    isStart: "The flow starts here",
    noSideQuestions: "No side questions about the person here",
    exits: "When to leave and where to",
    addExit: "Add a condition",
    more: "More",
    deleteState: "Delete the state",
    duration: "Lasts",
    durationHint: "Then goes to “Go to”. Days are flow days: a new day begins at the day start. “Until program day” lasts until that day starts, whenever the person entered the node.",
    durationNone: "no limit",
    durationUnits: { h: "hours", d: "days", program_day: "until program day" },
    durationTo: "Then go to",
    nudges: "Nudges",
    nudgesModes: { inherit: "As in the flow", own: "Own", off: "Off" },
    nudgesHint: "The agent writes here by itself while the person is silent.",
    nudgesDays: "Own nudges apply",
    nudgesDaysModes: { always: "the whole time in the state", days: "days, counting the entry day", untilProgramDay: "until program day, inclusive" },
    nudgesDaysHint: "Then the flow's nudges: the morning message and the common series from the start.",
    nudgesUntilProgramDayHint: "Reached the state later — no own nudges, the flow's nudges right away.",
  },
  exitCard: {
    when: "When",
    field: "Field",
    op: "Compare",
    value: "Value",
    event: "Event",
    eventName: "Which one",
    timer: "Count from",
    amount: "How long",
    at: "At",
    to: "Go to",
    moveUp: "Up",
    moveDown: "Down",
    delete: "Delete the condition",
  },
  anyStatePanel: {
    title: "Common transitions",
    hint: "Work from any state. The state's own conditions are checked first.",
    except: "Also not active here",
  },
  cardPanel: {
    title: "Card and notes",
    clientCard: "Client card",
    chatNotes: "Notes of this chat",
    chatNotesHint: "Live for the whole chat and are not remembered in the next one.",
    empty: "The client card and notes are empty so far.",
    name: "Name",
    about: "What it is and when to ask",
    type: "Type",
    options: "Options",
    optionsHint: "Options separated by commas",
    refreshAfter: "May go stale",
    refreshAfterMonths: (months) => `in ${months} mo.`,
    pace: "A question about the person — once per",
    paceEvery: (messages) => `once per ${messages} messages`,
    paceHint: "First tries to understand from what was said and asks only if that fails. Does not ask when the person is annoyed or in a hurry.",
    addField: "Add a field",
    newField: "New field",
    fromApp: "App field…",
  },
  checkPanel: {
    title: "Check",
    clean: "No problems found.",
    errors: "Errors",
    warnings: "Warnings",
    goTo: "Open",
    appCheckFailed: "The app's checks failed — their findings are missing here",
  },
  runPanel: {
    title: "Dry run",
    hint: "Dry run: choose on the right what happened",
    current: "Where the agent is",
    whatHappened: "What happened?",
    nothing: "None of these",
    known: "What the agent knows",
    notYet: "Not yet",
    nextQuestion: "Next question about the person",
    path: "Path so far",
    back: "Step back",
    restart: "Restart",
    finish: "Finish the dry run",
    step: (step) => `Dry run · step ${step}`,
    stay: "stay here",
    wontFire: "won't fire now",
    nothingHappened: "nothing fired",
    noStart: "No start state: mark where the flow begins",
  },
  jsonDialog: {
    title: "The graph as JSON",
    copy: "Copy",
    copied: "Copied",
    download: "Download",
    load: "Load",
    close: "Close",
  },
};
