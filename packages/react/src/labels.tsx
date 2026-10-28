import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { ChatError, ErrorNoticeKind, ReasoningLevelId } from "./chat-types";
import type { MemoryFailure } from "./memory/memory-types";
import type { ChatOriginView, HelperCallStatus, TaskStatusView } from "./skin-contract";
import type { SpendingInfo } from "./spending-status";
import type { VoiceDialogError, VoiceDialogState } from "./voice-dialog";
import type { VoiceErrorDetails, VoiceErrorKind } from "./voice-input";

/** Почему правка не ушла или не принята: идёт ответ, нет связи, сервер не принял. */
export type EditErrorKind = "busy" | "offline" | "rejected" | "spendingLimit" | "signedOut" | "tooManyTurns" | "forbiddenOrigin";

/** Надписи голосового режима (договор скина, версия 10). */
export interface VoiceDialogLabels {
  /** Кнопка включения режима. */
  start: string;
  /** Кнопка выхода из режима. */
  exit: string;
  /** Название меню голосов и подпись кнопки. */
  voiceMenu: string;
  /** Состояние режима словами. */
  states: Record<VoiceDialogState, string>;
  errors: Record<VoiceDialogError, string>;
  /** Отметка у ответа, озвучку которого оборвали: «Вы перебили: озвучено до «…»». */
  interruptedMark: (spokenTail: string) => string;
}

/** Надписи виджетов агента (договор скина, версия 13). */
export interface WidgetLabels {
  /** Пометка у виджета, на который человек ответил сообщением. */
  answeredByMessage: string;
  /** Кнопка отправки выбора, оценки и формы. */
  submit: string;
  /** Подсказка под вариантами: ответ можно написать словами. */
  choose: string;
  /** Подпись одной звезды или деления шкалы для экранного диктора: «Оценка 3 из 5». */
  ratingStars: (value: number, total: number) => string;
  /** Ответ не отправился. */
  answerFailed: string;
  /** Виджет из другой ветки: нажать его нельзя. */
  notCurrentBranch: string;
  /** Запасной вид, когда у скина нет виджета: ответить можно сообщением. */
  fallback: string;
  /** Пометка обязательного поля формы и ошибка пустого обязательного поля. */
  formRequired: string;
  /** Для экранного диктора, когда ход остановился на виджете. */
  asked: string;
  /** Для экранного диктора, когда ответ ушёл на сервер. */
  answerSent: string;
  /** Кнопка отправки формы. */
  formSubmit: string;
  /** Пределы выбора нескольких вариантов: «Выберите от 1 до 3». */
  choiceRange: (min: number, max: number) => string;
  /** Число или дата вне пределов; нет одного края — `undefined`. */
  formOutOfRange: (min: string | undefined, max: string | undefined) => string;
  /** В поле числа не число. */
  formNotNumber: string;
  /** В поле даты не дата. */
  formNotDate: string;
  /** Текст длиннее предела. */
  formTooLong: (max: number) => string;
  /** Сервер ответил, что вопрос уже не ждёт: на него ответили в другой вкладке или закрыли. */
  alreadyAnswered: string;
  /** Сервер не принял ответ (не прошёл проверку). */
  answerRejected: string;
  /** Проверка ответа на сервере не уложилась в срок: ответ не принят, виджет открыт. */
  answerCheckTimeout: string;
}

/** Надписи схем (договор скина, версия 13). */
export interface DiagramLabels {
  loading: string;
  failed: string;
  /** Подпись кнопки «открыть схему во весь экран». */
  open: string;
}

/** Надписи живых демонстраций (договор скина, версия 22). */
export interface LiveDemoLabels {
  /** Плашка, пока блок дописывается. */
  loading: string;
  /** Подпись рамки для диктора. */
  title: string;
  /** Пометка под кодом: демонстрация больше предела. */
  tooLarge: string;
  /** Пометка под кодом: ответ закончился, а блок не закрыт. */
  unfinished: string;
  /** Пометка под кодом: демонстрация попыталась уйти со своей страницы. */
  leftPage: string;
  /** Пометка под кодом: в чате есть чужой текст (интернет, файл), демонстрации в нём не запускаются. */
  externalContent: string;
}

/** Надписи картинок агента и вложений-картинок (договор скина, версия 13). */
export interface ImageLabels {
  loading: string;
  /** Подпись упавшей картинки; причину добавляет скин. */
  failed: string;
  /** Создание остановлено кнопкой «Стоп». */
  stopped: string;
  /** Подпись кнопки «открыть картинку в окне просмотра». */
  open: string;
}

/** Надписи видео агента (договор скина, версия 14). */
export interface VideoLabels {
  /** Подпись кнопки-карточки, которая запускает плеер. */
  play: string;
  /** «с 3:20» — с какой минуты начнётся видео. */
  from: (time: string) => string;
  fullscreen: string;
}

/** Надписи помощников (договор скина, версия 18). */
export interface HelperLabels {
  /** Заголовок задания помощнику: «Поручено». */
  assigned: string;
  /** Заголовок итога помощника: «Вернул». */
  returned: string;
  status: Record<HelperCallStatus, string>;
}

/** Надписи фоновых задач (договор скина, версия 18). */
export interface TaskLabels {
  status: Record<TaskStatusView, string>;
  cancel: string;
  /** Пока отмена идёт. */
  canceling: string;
  /** «идёт 2 мин 5 сек» у идущей задачи, «заняла 2 мин 5 сек» у законченной. */
  elapsed: (ms: number, finished: boolean) => string;
}

/** Надписи служебных сообщений (договор скина, версия 18). */
export interface NoticeLabels {
  taskDone: string;
  taskFailed: string;
  taskCanceled: string;
  taskInterrupted: string;
  taskTimedOut: string;
  taskAwaitingApproval: string;
  conversationStarted: string;
  /** Подпись реплики живого сотрудника у скина без `StaffMessage` (версия 25): «Сотрудник Ольга». */
  staffSaid: (staffName: string | undefined) => string;
  /** Служебное сообщение одной строкой — у скина без `AgentNoticeView`: «Отчёт»: задача готова. Без названия — только `status`. */
  line: (title: string, status: string) => string;
}

/** Строки статуса хода в мессенджерах: что делает агент, пока ответа ещё нет (договор скина, версия 18). */
export interface MessengerStatusLabels {
  thinking: string;
  /** «Использую инструмент: поиск в памяти». */
  usingTool: (title: string) => string;
  /** «Помощник «Аналитик» работает». */
  helperWorking: (name: string) => string;
  /** «Задача «Отчёт» ушла в фон». */
  taskInBackground: (title: string) => string;
  waitingForApproval: string;
}

/** Надписи простого вида работы агента (`workView: "simple"`, договор скина, версия 23). */
export interface WorkViewLabels {
  /** Шаг идёт, а фразы для инструмента нет: «Работаю». Без многоточия: его добавляет `live`. */
  stepRunning: string;
  /** Шаг готов, а фразы нет: «Сделал шаг». */
  stepDone: string;
  /** Шаг не получился: «Делаю календарь — не вышло»; `running` — фраза «идёт» без многоточия. */
  stepFailed: (running: string) => string;
  /** Шаг без фразы не получился: «Шаг не получился». */
  stepFailedUnknown: string;
  /** Ответ закончился посреди шага («Стоп», обрыв): «Делаю календарь — не закончил». */
  stepUnfinished: (running: string) => string;
  /** То же без фразы: «Шаг не закончен». */
  stepUnfinishedUnknown: string;
  /** Одинаковые шаги подряд одной строкой: «Поискал в интернете ×5». */
  stepRepeated: (phrase: string, count: number) => string;
  /** Модель думает: «Думаю». */
  thinking: string;
  /** Раздумье без заголовка в списке шагов (договор 28): «Думал 4 сек»; времени нет — «Подумал». */
  thought: (durationMs: number | null) => string;
  /** Скрытые значки длинного ряда (договор 28): «+3». */
  moreSteps: (count: number) => string;
  /** Живая строка: «Рисую календарь…». */
  live: (phrase: string) => string;
  /** Свёрнутые шаги: «Сделано 3 шага»; `count` — число вызовов, вместе с повторами. */
  stepsDone: (count: number) => string;
  /** Помощник работает и закончил, если приложение не дало фраз: «Помощник «Аналитик» работает». */
  helperRunning: (name: string) => string;
  helperDone: (name: string) => string;
}

/** Надписи окна просмотра (договор скина, версия 13). */
export interface ViewerLabels {
  close: string;
  next: string;
  previous: string;
  /** Кнопка «вписать в экран» после масштабирования. */
  fit: string;
  /** Счётчик «3 из 12»; только при нескольких элементах. */
  counter: (position: number, total: number) => string;
}

/** Надписи для голоса вне голосового режима (договор скина, версия 13). */
export interface VoiceSpeechLabels {
  /** Что слышно вместо блока схемы. */
  diagramOnScreen: string;
  /** Что слышно на месте карточки видео (версия 14). */
  videoOnScreen: string;
  /** Фраза к озвучке ждущего выбора: вопрос и варианты. */
  widgetChoices: (question: string, options: readonly string[]) => string;
  /** Фраза к озвучке ждущей формы, оценки или своего виджета; `title` — вопрос или заголовок, если есть. */
  widgetOnScreen: (title?: string) => string;
}

/**
 * Все надписи интерфейса чата. Скин берёт их отсюда и сам строк не пишет. Группы версии 13 (`widgets`, `diagram`, `images`,
 * `viewer`, `voice`) и версии 14 (`videos`) необязательные: словарь приложения, написанный раньше, работает, недостающее берётся из `russianLabels`;
 * внутри группы можно перекрыть любой один ключ.
 */
export interface ComposerSettingsLabels {
  levels: Record<string, string>;
  model: string; reasoning: string; tools: string; settings: string; done: string; via: string;
  search: string; showReasoning: string; project: string; file: string; image: string;
  textModels: string; imageModels: string; models: string; noResults: string; price: string; input: string; output: string;
}

export interface ChatLabels {
  /** Приветствие пустого чата. Скины без приветствия игнорируют. */
  welcome?: { title?: string; description?: string };
  composerSettings?: Partial<ComposerSettingsLabels>;
  /**
   * Язык словаря (BCP 47): `ru` у `russianLabels`, `en` у `englishLabels`. Скин по нему выбирает свои надписи — например,
   * Тандем ставит словарь дизайн-системы на том же языке. Нет — скин решает сам (Тандем: русский или словарь приложения).
   */
  locale?: string;
  history?: { loading: string; failed: string; older: string };
  composerPlaceholder: string;
  /** Подпись поля ввода для экранного диктора. */
  composerLabel: string;
  send: string;
  stop: string;
  copyAnswer: string;
  copied: string;
  copyCode: string;
  reasoningRunning: string;
  reasoningDone: (seconds: number) => string;
  /**
   * Фразы, которые сменяют друг друга каждые 3–4 с, пока модель думает и текста ответа ещё нет. Пустой набор — одна
   * `reasoningRunning`. Нет — русские по умолчанию, а если `reasoningRunning` своя (словарь на другом языке) — она одна.
   */
  thinkingPhrases?: readonly string[];
  /** Время ожидания ответа рядом с фразой: «12 с», «1 мин 5 с». Нет, а `reasoningRunning` своя — «0:12», «1:05». */
  thinkingElapsed?: (seconds: number) => string;
  toolRunning: (toolName: string) => string;
  toolDone: (toolName: string) => string;
  toolError: (toolName: string) => string;
  /** Подпись картинки со снимком страницы для экранного диктора. */
  screenshotAlt: string;
  /** Снимок страницы не загрузился: вместо картинки этот текст и ссылка на страницу. */
  screenshotUnavailable: string;
  answerStopped: string;
  answerInterrupted: string;
  answerEmpty: string;
  /** Подпись ссылки вместо картинки с чужого адреса, если у картинки нет своей подписи. Нет — русская по умолчанию. */
  externalImageLink?: string;
  /** Отметка у ответа, который модель не дописала: упёрлась в предел длины ответа. Нет — русская по умолчанию. */
  answerCutByLength?: string;
  /** Отметка у ответа агента, который исправил человек (версия 15). Нет — русская по умолчанию. */
  answerEdited?: string;
  /** Серая отметка у ответа, который не дошёл до человека (версия 24). Нет — русская по умолчанию. */
  answerUndelivered?: string;
  /** Отметка у вызова инструмента, чей результат исправил человек (версия 15). Нет — русская по умолчанию. */
  toolOutputEdited?: string;
  /** Кнопка «изменить» у ответа агента (версия 15). Нет — русская по умолчанию. */
  editAnswer?: string;
  /** Пометка у поправки, которую агент ещё не взял (версия 21): «учтёт на следующем шаге». Нет — русская по умолчанию. */
  steeringPending?: string;
  retry: string;
  /** Идут попытки подключиться к серверу. */
  reconnecting: string;
  /** Попытки исчерпаны: сервер недоступен. */
  connectionLost: string;
  /** Чат чужой или его нет: сервер не различает эти случаи. */
  chatNotFound: string;
  errors: Record<ErrorNoticeKind, string>;
  /**
   * Подпись сбоя ответа функцией от сбоя: вид и подробности `details`, если сервер их отдал (право `errorDetails`).
   * `plain` — `errors[kind]`; вернуть его — подпись как раньше. Нет функции — `errors[kind]`. Скину уходит текстом
   * (`ErrorNotice` `text`), без разметки; диктору — тот же текст.
   */
  errorText?: (error: ChatError, plain: string) => string;
  /** Названия уровней рассуждений в меню выбора; названия моделей и провайдеров приходят с сервера. */
  reasoningLevels: Record<ReasoningLevelId, string>;
  /** Разделитель на границе сжатой истории. */
  historyCompacted: string;
  /** Пояснение под разделителем, когда открыта сводка. */
  historyCompactedHint: string;
  /** Где сейчас переключатель веток, для экранного диктора: «Вариант 2 из 3». */
  branchPosition: (position: number, count: number) => string;
  previousBranch: string;
  nextBranch: string;
  /** Кнопка у последнего ответа: новый ответ на тот же вопрос. */
  regenerate: string;
  /** Кнопка у отправленного сообщения и подпись поля правки. */
  editMessage: string;
  /** Отправить исправленное сообщение. */
  saveEdit: string;
  cancelEdit: string;
  /** Под полем правки, когда правку не удалось отправить; текст в поле остаётся. */
  editErrors: Record<EditErrorKind, string>;
  /** Под полем правки, когда сервер отказал по лимиту сообщений (у денег — `editErrors.spendingLimit`). */
  editMessageLimit?: string;
  /** Не удалось сохранить выбор модели. */
  modelChoiceFailed: string;
  /** Не удалось получить список моделей. */
  modelMenuFailed: string;
  /** Кнопка микрофона в покое. */
  voiceStart: string;
  /** Кнопка микрофона, пока идёт запись. */
  voiceStop: string;
  /** Кнопка микрофона, пока готовится запись: нажатие отменяет. */
  voiceConnecting: string;
  /** Кнопка микрофона, пока сервер причёсывает надиктованный текст (убирает «э-э», расставляет знаки). */
  voicePolishing: string;
  voiceErrors: VoiceErrorLabels;
  voiceDialog: VoiceDialogLabels;
  /** Заголовок карточки: что агент хочет сделать (`action` — название действия). */
  approvalRequested: (action: string) => string;
  /** Пока человек не решил. */
  approvalWaiting: string;
  approvalAllow: string;
  approvalDeny: string;
  approvalAlways: string;
  /** Ответ не дошёл до сервера. */
  approvalFailed: string;
  /** Ответ не принят: лимит расходов исчерпан. */
  approvalSpendingLimit: string;
  /** Ответ не принят: в чате идёт другой ход. */
  approvalBusy: string;
  /** Ответ не принят: у человека уже идут ответы в других чатах. */
  approvalTooManyTurns: string;
  approvalAllowedMark: string;
  approvalAlwaysMark: string;
  approvalDeniedMark: string;
  /** Для экранного диктора, когда ход остановился на запросе. */
  approvalAnnouncement: string;
  /** Расход подошёл к лимиту, но чат ещё работает: «Использовано 80% лимита на месяц». */
  spendingWarning: (info: SpendingInfo) => string;
  /** Лимит исчерпан, новые сообщения не отправляются: «Лимит на месяц исчерпан, обновится 1 ноября». */
  spendingExhausted: (info: SpendingInfo) => string;
  /** Окно сообщений подошло к лимиту (`unit: "messages"`): «Осталось 2 сообщения». */
  spendingMessagesLeft?: (remaining: number, info: SpendingInfo) => string;
  /** Окно сообщений исчерпано: «Лимит сообщений исчерпан, обновится 8 октября». */
  spendingMessagesExhausted?: (info: SpendingInfo) => string;
  /** Заголовок списка чатов и кнопка «Чаты» на узком экране. */
  chatListHeading: string;
  chatListNewChat: string;
  /** Название чата, в котором ещё ничего не писали. */
  chatListUntitled: string;
  /** Пометка чата, начатого в мессенджере: «Telegram», «ВКонтакте», «MAX». */
  chatListOrigin: Record<ChatOriginView, string>;
  /** Пометка закрытого чата в списке (причину скин берёт из `closed.message`). */
  chatListClosed: string;
  chatListLoading: string;
  chatListLoadFailed: string;
  chatListCreateFailed: string;
  chatListRenameFailed: string;
  chatListDeleteFailed: string;
  /** Кнопка меню строки: «Действия с чатом …». */
  chatListRowMenu: (title: string) => string;
  chatListRename: string;
  chatListRenameField: string;
  chatListDelete: string;
  chatListDeleteTitle: string;
  chatListDeleteBody: (title: string) => string;
  chatListDeleteConfirm: string;
  chatListDeleteCancel: string;
  /** Экран памяти агента: заголовок и счётчик «Записей: 12 из 200». */
  memoryHeading: string;
  memoryCount: (total: number, limit: number) => string;
  /** Подсказка, когда в запрос агента попадают не все записи: остальное он находит поиском. */
  memoryShownHint: (shown: number, total: number) => string;
  memoryAdd: string;
  memoryClearAll: string;
  memoryLoading: string;
  memoryEmpty: string;
  /** Сервер ответил 404: память в этом приложении не включена. */
  memoryUnavailable: string;
  memoryLoadFailed: string;
  memoryEdit: string;
  memoryDelete: string;
  /** Подписи кнопок записи для экранного диктора: «Изменить запись «Любит чай»». */
  memoryEditNote: (content: string) => string;
  memoryDeleteNote: (content: string) => string;
  /** Заголовок группы записей для экранного диктора: «Работа, записей: 3». */
  memoryGroupLabel: (name: string, count: number) => string;
  memoryNewNoteTitle: string;
  memoryEditNoteTitle: string;
  memoryPathField: string;
  memoryPathHint: string;
  memoryContentField: string;
  memorySave: string;
  memoryCancel: string;
  /** Ошибки полей: проверка до отправки. */
  memoryFieldErrors: {
    pathRequired: string;
    pathTooMany: string;
    pathTooLong: string;
    contentRequired: string;
    contentTooLong: string;
  };
  /** Почему действие с памятью не удалось. */
  memoryErrors: Record<MemoryFailure, string>;
  memoryDeleteTitle: string;
  memoryDeleteBody: (content: string) => string;
  memoryClearTitle: string;
  memoryClearBody: (total: number) => string;
  memoryConfirmDelete: string;
  memoryConfirmClear: string;
  memoryConfirmCancel: string;
  /** Блок «Объединено»: агент склеил повторы; «было» — скрытые оригиналы, «стало» — запись в списке. */
  memoryMergesHeading: string;
  /** Когда слияние сделано: «30 сентября в 12:05» (по местному времени). */
  memoryMergeDate: (finishedAt: Date) => string;
  memoryMergeBefore: string;
  memoryMergeAfter: string;
  memoryMergeRevert: string;
  /** Имя кнопки для экранного диктора: у каждого слияния своя, «Вернуть как было (30 сентября в 12:05)». */
  memoryMergeRevertFor: (when: string) => string;
  /** Вместо кнопки, когда результат склейки с тех пор менялся. */
  memoryMergeNotRevertible: string;
  /** Когда «Вернуть как было» отклонено: памяти не хватит места или запись, что вернулась бы, уже добавлена заново. */
  memoryRevertErrors: Record<"limit_reached" | "duplicate", string>;
  /** Панель агента (договор скина версии 12): кнопка в углу страницы, подписи панели и списка чатов над чатом. */
  agentPanelLauncher: string;
  agentPanelOpen: string;
  agentPanelClose: string;
  agentPanelLabel: string;
  agentPanelChats: string;
  agentPanelBackToChat: string;
  /** Значок на кнопке, пока идёт ответ. */
  agentPanelBusy: string;
  /** Ответ модели, когда браузерного инструмента нет на этой странице (функции нет у `AgentPanelProvider`). */
  agentPanelToolUnavailable: string;
  widgets?: Partial<WidgetLabels>;
  diagram?: Partial<DiagramLabels>;
  demo?: Partial<LiveDemoLabels>;
  images?: Partial<ImageLabels>;
  videos?: Partial<VideoLabels>;
  viewer?: Partial<ViewerLabels>;
  voice?: Partial<VoiceSpeechLabels>;
  helpers?: Partial<HelperLabels>;
  tasks?: Partial<TaskLabels>;
  notices?: Partial<NoticeLabels>;
  messengerStatus?: Partial<MessengerStatusLabels>;
  workView?: Partial<WorkViewLabels>;
}

const periodPhrases = { month: " на месяц", week: " на неделю", day: " на день", none: "" } as const;
function periodPhrase(info: SpendingInfo): string {
  if (info.period === "rolling") return info.hours ? ` на ${info.hours} ч` : "";
  return periodPhrases[info.period];
}
const scopePhrase = (info: SpendingInfo) => (info.scope === "chat" ? " этого чата" : info.scope === "service" ? " сервиса" : "");
/** Дата обновления лимита по поясу лимитов (без него — UTC); пояс, которого браузер не знает, — тоже UTC. */
function resetDate(moment: Date, timeZone = "UTC", withTime = false): string {
  const format = (zone: string) => {
    const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: zone }).format(moment);
    if (!withTime) return date;
    return `${date} в ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(moment)}`;
  };
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}
/** Скользящее окно обновляется посреди дня: к дате нужно время. */
const resetPhrase = (info: SpendingInfo) => (info.resetsAt ? `, обновится ${resetDate(info.resetsAt, info.timeZone, info.period === "rolling")}` : "");
const mergeDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Словарь, в котором есть и необязательные надписи: их подставляет `ChatLabelsProvider`. */
export type ResolvedChatLabels = Omit<ChatLabels, "widgets" | "diagram" | "demo" | "images" | "videos" | "viewer" | "voice" | "helpers" | "tasks" | "notices" | "messengerStatus" | "workView" | "composerSettings" | "welcome" | "history"> &
  Required<
    Pick<
      ChatLabels,
      "externalImageLink" | "answerCutByLength" | "answerEdited" | "answerUndelivered" | "toolOutputEdited" | "editAnswer" | "steeringPending" | "thinkingPhrases" | "thinkingElapsed" | "spendingMessagesLeft" | "spendingMessagesExhausted" | "editMessageLimit"
    >
  > & {
    history: NonNullable<ChatLabels["history"]>;
    welcome: { title: string; description: string };
    composerSettings: ComposerSettingsLabels;
    widgets: WidgetLabels;
    diagram: DiagramLabels;
    demo: LiveDemoLabels;
    images: ImageLabels;
    videos: VideoLabels;
    viewer: ViewerLabels;
    voice: VoiceSpeechLabels;
    helpers: HelperLabels;
    tasks: TaskLabels;
    notices: NoticeLabels;
    messengerStatus: MessengerStatusLabels;
    workView: WorkViewLabels;
  };

/**
 * Подписи ошибок голоса. `time_limit` — строка или функция от предела записи, названного сервером (секунды).
 * `limit`, `forbidden`, `too_long` можно не задавать: возьмутся подписи по умолчанию на языке словаря (`locale`).
 */
export type VoiceErrorLabels = Record<Exclude<VoiceErrorKind, "time_limit" | "limit" | "forbidden" | "too_long">, string> & {
  time_limit: string | ((maxSessionSeconds: number) => string);
  limit?: string;
  forbidden?: string;
  too_long?: string;
};

/** Предел записи, если сервер его не назвал (старый сервер): как у сервера по умолчанию. */
const DEFAULT_VOICE_LIMIT_SECONDS = 300;

let reportedErrorTextFailure = false;

/**
 * Подпись сбоя ответа от `errorText` словаря; функции нет — `undefined`: скин покажет `errors[kind]` сам. Функция
 * приложения упала — прежняя подпись `errors[kind]` и одна строка в консоль: ответ не падает при отрисовке.
 */
export function customErrorText(labels: Pick<ResolvedChatLabels, "errors" | "errorText">, error: ChatError | undefined): string | undefined {
  if (!error || !labels.errorText) return undefined;
  const plain = labels.errors[error.kind];
  try {
    return labels.errorText(error, plain);
  } catch (failure) {
    if (!reportedErrorTextFailure) {
      reportedErrorTextFailure = true;
      console.error("labels.errorText упал — показана обычная подпись сбоя.", failure);
    }
    return plain;
  }
}

/** Подпись ошибки голоса для человека. */
export function voiceErrorText(errors: VoiceErrorLabels, kind: VoiceErrorKind, details?: VoiceErrorDetails): string {
  if (kind !== "time_limit") return errors[kind] ?? errors.other;
  const label = errors.time_limit;
  return typeof label === "string" ? label : label(details?.maxSessionSeconds ?? DEFAULT_VOICE_LIMIT_SECONDS);
}

const russianPlural = new Intl.PluralRules("ru-RU");
/** «1 сообщение», «2 сообщения», «5 сообщений». */
function russianCount(count: number, forms: { one: string; few: string; many: string }): string {
  const form = russianPlural.select(count);
  return `${count} ${form === "one" ? forms.one : form === "few" ? forms.few : forms.many}`;
}

/** «2 мин 5 сек» / «45 сек» для русских надписей длительности. */
function russianDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} мин ${seconds % 60} сек` : `${seconds} сек`;
}

function englishDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

const russianHelpers: HelperLabels = {
  assigned: "Поручено",
  returned: "Вернул",
  status: { running: "Работает…", awaiting_approval: "Ждёт подтверждения", done: "Готово", failed: "Не получилось", background: "Работает в фоне" },
};

const russianTasks: TaskLabels = {
  status: {
    queued: "В очереди",
    running: "Идёт",
    awaiting_approval: "Ждёт подтверждения",
    done: "Готово",
    failed: "Ошибка",
    canceled: "Отменена",
    interrupted: "Прервана",
    timed_out: "Не уложилась во время",
  },
  cancel: "Отменить",
  canceling: "Отменяем…",
  elapsed: (ms, finished) => `${finished ? "заняла" : "идёт"} ${russianDuration(ms)}`,
};

const russianNotices: NoticeLabels = {
  taskDone: "задача готова",
  taskFailed: "задача не удалась",
  taskCanceled: "задача отменена",
  taskInterrupted: "задача прервана",
  taskTimedOut: "задача не уложилась во время",
  taskAwaitingApproval: "задача ждёт подтверждения",
  conversationStarted: "агент написал первым",
  staffSaid: (staffName) => (staffName ? `Сотрудник ${staffName}` : "Сотрудник"),
  line: (title, status) => (title ? `«${title}»: ${status}` : status),
};

const russianMessengerStatus: MessengerStatusLabels = {
  thinking: "Думаю…",
  usingTool: (title) => `Использую инструмент: ${title}`,
  helperWorking: (name) => `Помощник «${name}» работает`,
  taskInBackground: (title) => `Задача «${title}» ушла в фон`,
  waitingForApproval: "Жду вашего решения",
};

/** Многоточие живой строки — одно, даже если оно уже есть во фразе. */
const withEllipsis = (phrase: string) => (/(…|\.\.\.)$/.test(phrase) ? phrase : `${phrase}…`);

const russianWorkView: WorkViewLabels = {
  stepRunning: "Работаю",
  stepDone: "Сделал шаг",
  stepFailed: (running) => `${running} — не вышло`,
  stepFailedUnknown: "Шаг не получился",
  stepUnfinished: (running) => `${running} — не закончил`,
  stepUnfinishedUnknown: "Шаг не закончен",
  stepRepeated: (phrase, count) => `${phrase} ×${count}`,
  thinking: "Думаю",
  thought: (durationMs) => (durationMs === null ? "Подумал" : `Думал ${Math.max(1, Math.round(durationMs / 1000))} сек`),
  moreSteps: (count) => `+${count}`,
  live: withEllipsis,
  stepsDone: (count) => `${russianPlural.select(count) === "one" ? "Сделан" : "Сделано"} ${russianCount(count, { one: "шаг", few: "шага", many: "шагов" })}`,
  helperRunning: (name) => `Помощник «${name}» работает`,
  helperDone: (name) => `Помощник «${name}» закончил`,
};

/** Английские надписи простого вида работы агента (версия 23); входят в `englishLabels`. */
export const englishWorkViewLabels: WorkViewLabels = {
  stepRunning: "Working",
  stepDone: "Did a step",
  stepFailed: (running) => `${running} — didn’t work`,
  stepFailedUnknown: "A step didn’t work",
  stepUnfinished: (running) => `${running} — not finished`,
  stepUnfinishedUnknown: "A step wasn’t finished",
  stepRepeated: (phrase, count) => `${phrase} ×${count}`,
  thinking: "Thinking",
  thought: (durationMs) => (durationMs === null ? "Thought" : `Thought for ${Math.max(1, Math.round(durationMs / 1000))} s`),
  moreSteps: (count) => `+${count}`,
  live: withEllipsis,
  stepsDone: (count) => `${count} ${count === 1 ? "step" : "steps"} done`,
  helperRunning: (name) => `Helper “${name}” is working`,
  helperDone: (name) => `Helper “${name}” is done`,
};

/** Английские надписи версий 18 и 21 для приложений, которые подключают их через `ChatLabels`. */
export const englishWorkLabels: Pick<ResolvedChatLabels, "helpers" | "tasks" | "notices" | "messengerStatus" | "steeringPending"> = {
  steeringPending: "The agent will take this into account at the next step",
  helpers: {
    assigned: "Assigned",
    returned: "Returned",
    status: { running: "Working…", awaiting_approval: "Waiting for approval", done: "Done", failed: "Failed", background: "Working in the background" },
  },
  tasks: {
    status: {
      queued: "Queued",
      running: "Running",
      awaiting_approval: "Waiting for approval",
      done: "Done",
      failed: "Failed",
      canceled: "Canceled",
      interrupted: "Interrupted",
      timed_out: "Ran out of time",
    },
    cancel: "Cancel",
    canceling: "Canceling…",
    elapsed: (ms, finished) => `${finished ? "took" : "running"} ${englishDuration(ms)}`,
  },
  notices: {
    taskDone: "task is done",
    taskFailed: "task failed",
    taskCanceled: "task canceled",
    taskInterrupted: "task interrupted",
    taskTimedOut: "task ran out of time",
    taskAwaitingApproval: "task is waiting for approval",
    conversationStarted: "the agent wrote first",
    staffSaid: (staffName) => (staffName ? `Staff: ${staffName}` : "Staff"),
    line: (title, status) => (title ? `“${title}”: ${status}` : status),
  },
  messengerStatus: {
    thinking: "Thinking…",
    usingTool: (title) => `Using a tool: ${title}`,
    helperWorking: (name) => `Helper “${name}” is working`,
    taskInBackground: (title) => `Task “${title}” moved to the background`,
    waitingForApproval: "Waiting for your decision",
  },
};

export const russianLabels: ResolvedChatLabels = {
  locale: "ru",
  welcome: { title: "С чего начнём?", description: "Задайте вопрос или опишите задачу." },
  helpers: russianHelpers,
  tasks: russianTasks,
  notices: russianNotices,
  messengerStatus: russianMessengerStatus,
  workView: russianWorkView,
  composerSettings: { levels: { off: "Выкл", on: "Вкл", minimal: "Минимум", low: "Низко", medium: "Средне", high: "Высоко", max: "Максимум" }, model: "Модель", reasoning: "Рассуждения", tools: "Инструменты", settings: "Настройки ответа", done: "Готово", via: "Через", search: "Найти модель", showReasoning: "Показывать ход мысли", project: "Проект", file: "Файл", image: "Картинка", textModels: "Текстовые задачи", imageModels: "Текст и изображения", models: "Модели", noResults: "Ничего не найдено", price: "USD за миллион токенов", input: "вход", output: "выход" },
  composerPlaceholder: "Напишите сообщение",
  composerLabel: "Сообщение",
  send: "Отправить",
  stop: "Остановить",
  copyAnswer: "Скопировать ответ",
  copied: "Скопировано",
  copyCode: "Скопировать код",
  reasoningRunning: "Думает…",
  reasoningDone: (seconds) => `Думал ${seconds} сек`,
  thinkingPhrases: [
    "Думаю…",
    "Прикидываю…",
    "Раскладываю по полочкам…",
    "Сверяю детали…",
    "Собираю мысли…",
    "Взвешиваю варианты…",
    "Ищу лучший ход…",
    "Проверяю себя…",
    "Складываю картину…",
    "Обдумываю…",
  ],
  thinkingElapsed: (seconds) => {
    if (seconds < 60) return `${seconds} с`;
    const rest = seconds % 60;
    return rest === 0 ? `${Math.floor(seconds / 60)} мин` : `${Math.floor(seconds / 60)} мин ${rest} с`;
  },
  toolRunning: (toolName) => `${toolName}: выполняется`,
  toolDone: (toolName) => `${toolName}: готово`,
  toolError: (toolName) => `${toolName}: ошибка`,
  screenshotAlt: "Снимок страницы",
  screenshotUnavailable: "Снимок не загрузился.",
  answerStopped: "Остановлено",
  answerInterrupted: "Ответ прерван",
  answerEmpty: "Модель не дала ответа",
  externalImageLink: "картинка",
  answerCutByLength: "Ответ оборван по длине",
  answerEdited: "Изменено человеком",
  answerUndelivered: "Не доставлено",
  toolOutputEdited: "Результат изменён",
  steeringPending: "Агент учтёт на следующем шаге",
  editAnswer: "Изменить ответ",
  history: { loading: "Загружаю подробности…", failed: "Не удалось загрузить", older: "Более ранние сообщения" },
  retry: "Повторить",
  reconnecting: "Переподключаемся…",
  connectionLost: "Нет связи с сервером",
  chatNotFound: "Чат не найден",
  errors: {
    overloaded: "Модель перегружена, попробуйте ещё раз",
    rate_limited: "Слишком много запросов, попробуйте через минуту",
    insufficient_funds: "На счёте провайдера закончились деньги",
    invalid_key: "Ключ провайдера не подходит",
    context_overflow: "Переписка не помещается в модель. Начните новый чат или выберите модель с большим окном",
    other: "Что-то пошло не так, попробуйте ещё раз",
    signed_out: "Вход истёк. Войдите снова",
    too_many_turns: "Уже идут ответы в других чатах. Дождитесь, пока один закончится, и отправьте снова",
    forbidden_origin: "Сервер чата не принимает сообщения с этой страницы. Сообщите администратору сайта",
  },
  reasoningLevels: {
    off: "Выкл",
    on: "Вкл",
    minimal: "Минимальный",
    low: "Низкий",
    medium: "Средний",
    high: "Высокий",
    max: "Максимум",
  },
  historyCompacted: "История сжата",
  historyCompactedHint: "Вместо сообщений выше модель видит эту сводку. Сами сообщения никуда не делись.",
  branchPosition: (position, count) => `Вариант ${position} из ${count}`,
  previousBranch: "Предыдущий вариант",
  nextBranch: "Следующий вариант",
  regenerate: "Переделать ответ",
  editMessage: "Изменить сообщение",
  saveEdit: "Отправить",
  cancelEdit: "Отмена",
  editErrors: {
    busy: "Ответ ещё идёт. Дождитесь его конца и отправьте снова",
    offline: "Нет связи с сервером. Текст сохранён в поле",
    rejected: "Сервер не принял правку. Текст сохранён в поле",
    spendingLimit: "Лимит расходов исчерпан. Текст сохранён в поле",
    signedOut: "Вход истёк. Войдите снова. Текст сохранён в поле",
    tooManyTurns: "Уже идут ответы в других чатах. Текст сохранён в поле",
    forbiddenOrigin: "Сервер чата не принимает сообщения с этой страницы. Текст сохранён в поле",
  },
  editMessageLimit: "Лимит сообщений исчерпан. Текст сохранён в поле",
  modelChoiceFailed: "Не удалось сменить модель",
  modelMenuFailed: "Список моделей не загрузился",
  voiceStart: "Диктовать",
  voiceStop: "Остановить диктовку",
  voiceConnecting: "Подключаемся к микрофону…",
  voicePolishing: "Приводим текст в порядок…",
  voiceErrors: {
    permission_denied: "Нет доступа к микрофону. Разрешите его в настройках браузера",
    no_microphone: "Микрофон не найден",
    unsupported: "Этот браузер не умеет записывать звук",
    network: "Нет связи, диктовка прервана",
    service_unavailable: "Сервис распознавания речи недоступен",
    other: "Не удалось начать диктовку",
    rate_limited: "Слишком много диктовок подряд, попробуйте через минуту",
    time_limit: (seconds) =>
      `Запись остановлена: предел ${seconds % 60 === 0 ? russianCount(seconds / 60, { one: "минута", few: "минуты", many: "минут" }) : russianCount(seconds, { one: "секунда", few: "секунды", many: "секунд" })}`,
    limit: "Лимит расходов исчерпан, диктовка недоступна",
    forbidden: "Нет доступа к диктовке",
    too_long: "Запись слишком длинная",
  },
  voiceDialog: {
    start: "Голосовой режим",
    exit: "Выйти",
    voiceMenu: "Голос",
    states: {
      off: "Голосовой режим выключен",
      connecting: "Подключаемся…",
      listening: "Слушаю",
      thinking: "Думаю",
      speaking: "Говорю",
      interrupted: "Вы перебили",
      error: "Что-то пошло не так",
    },
    errors: {
      microphone_denied: "Нет доступа к микрофону. Разрешите его в настройках браузера",
      microphone_missing: "Микрофон недоступен: нужны микрофон, https и свежий браузер",
      network: "Нет связи, голосовой режим остановлен",
      service_unavailable: "Голосовой сервис недоступен",
      recognition_lost: "Распознавание речи оборвалось",
      speech_unavailable: "Озвучка недоступна: ответы приходят текстом",
      limit: "Лимит расходов исчерпан",
      rate_limited: "Слишком много включений подряд, попробуйте через минуту",
      idle: "Режим выключен: долго не было слышно речи",
      backgrounded: "Режим выключен: страница ушла в фон",
    },
    interruptedMark: (spokenTail) => `Вы перебили: озвучено до «${spokenTail}»`,
  },
  approvalRequested: (action) => `Агент хочет: ${action}`,
  approvalWaiting: "Ждёт вашего решения",
  approvalAllow: "Разрешить",
  approvalDeny: "Отклонить",
  approvalAlways: "Всегда в этом чате",
  approvalFailed: "Ответ не дошёл до сервера, попробуйте ещё раз",
  approvalSpendingLimit: "Лимит расходов исчерпан, ответить сейчас нельзя",
  approvalBusy: "Чат занят другим ходом, попробуйте ещё раз",
  approvalTooManyTurns: "Уже идут ответы в других чатах, попробуйте чуть позже",
  approvalAllowedMark: "Разрешено",
  approvalAlwaysMark: "Разрешено в этом чате",
  approvalDeniedMark: "Отклонено",
  approvalAnnouncement: "Агент ждёт вашего решения",
  spendingWarning: (info) => {
    const percent = Math.min(99, Math.floor((info.share ?? 0) * 100 + 1e-6));
    return `Использовано ${percent}% лимита${scopePhrase(info)}${periodPhrase(info)}`;
  },
  spendingExhausted: (info) => {
    if (info.reason === "blocked") return "Новые ответы для вас приостановлены";
    if (info.reason === "reserve") return `Лимита${scopePhrase(info)}${periodPhrase(info)} не хватит на новый ответ${resetPhrase(info)}`;
    return `Лимит${scopePhrase(info)}${periodPhrase(info)} исчерпан${resetPhrase(info)}`;
  },
  spendingMessagesLeft: (remaining) => `Осталось ${russianCount(remaining, { one: "сообщение", few: "сообщения", many: "сообщений" })}`,
  spendingMessagesExhausted: (info) => `Лимит сообщений исчерпан${resetPhrase(info)}`,
  chatListHeading: "Чаты",
  chatListNewChat: "Новый чат",
  chatListUntitled: "Новый чат",
  chatListOrigin: { telegram: "Telegram", vk: "ВКонтакте", max: "MAX" },
  chatListClosed: "Закрыт",
  chatListLoading: "Загружаем чаты…",
  chatListLoadFailed: "Список чатов не загрузился",
  chatListCreateFailed: "Не удалось создать чат",
  chatListRenameFailed: "Не удалось переименовать чат",
  chatListDeleteFailed: "Не удалось удалить чат",
  chatListRowMenu: (title) => `Действия с чатом «${title}»`,
  chatListRename: "Переименовать",
  chatListRenameField: "Название чата",
  chatListDelete: "Удалить",
  chatListDeleteTitle: "Удалить чат?",
  chatListDeleteBody: (title) => `Чат «${title}» и вся его переписка будут удалены насовсем.`,
  chatListDeleteConfirm: "Удалить",
  chatListDeleteCancel: "Отмена",
  memoryHeading: "Память",
  memoryCount: (total, limit) => `Записей: ${total} из ${limit}`,
  memoryShownHint: (shown, total) => `Показано агенту: ${shown} из ${total}. Остальное он находит поиском.`,
  memoryAdd: "Добавить",
  memoryClearAll: "Стереть всю память",
  memoryLoading: "Загружаем память…",
  memoryEmpty: "Память пуста. Агент запоминает важное по ходу разговора, а вы можете добавить запись сами.",
  memoryUnavailable: "Память в этом приложении не включена",
  memoryLoadFailed: "Память не загрузилась",
  memoryEdit: "Изменить",
  memoryDelete: "Удалить",
  memoryEditNote: (content) => `Изменить запись «${content}»`,
  memoryDeleteNote: (content) => `Удалить запись «${content}»`,
  memoryGroupLabel: (name, count) => `${name}, записей: ${count}`,
  memoryNewNoteTitle: "Новая запись",
  memoryEditNoteTitle: "Изменить запись",
  memoryPathField: "Раздел",
  memoryPathHint: "До трёх уровней через «/», например: О себе / Работа",
  memoryContentField: "Запись",
  memorySave: "Сохранить",
  memoryCancel: "Отмена",
  memoryFieldErrors: {
    pathRequired: "Укажите раздел",
    pathTooMany: "Не больше трёх уровней раздела",
    pathTooLong: "Название раздела не длиннее 60 знаков",
    contentRequired: "Напишите текст записи",
    contentTooLong: "Запись не длиннее 500 знаков",
  },
  memoryErrors: {
    not_found: "Такой записи уже нет. Список обновлён",
    stale_version: "Запись изменилась в другом месте. Список обновлён: проверьте и повторите",
    limit_reached: "Память заполнена. Удалите ненужные записи и повторите",
    duplicate: "Такая запись уже есть",
    invalid: "Сервер не принял запись. Проверьте разделы и текст",
    conflict: "Вернуть как было уже нельзя: записи с тех пор менялись. Список обновлён",
    unavailable: "Память в этом приложении не включена",
    other: "Не удалось выполнить действие, попробуйте ещё раз",
  },
  memoryDeleteTitle: "Удалить запись?",
  memoryDeleteBody: (content) => `Запись «${content}» будет удалена насовсем.`,
  memoryClearTitle: "Стереть всю память?",
  memoryClearBody: (total) => `Все записи (${total}) будут удалены насовсем. Агент забудет всё, что знал о вас.`,
  memoryConfirmDelete: "Удалить",
  memoryConfirmClear: "Стереть всё",
  memoryConfirmCancel: "Отмена",
  memoryMergesHeading: "Объединено",
  memoryMergeDate: (finishedAt) => mergeDate.format(finishedAt),
  memoryMergeBefore: "Было",
  memoryMergeAfter: "Стало",
  memoryMergeRevert: "Вернуть как было",
  memoryMergeRevertFor: (when) => `Вернуть как было (${when})`,
  memoryMergeNotRevertible: "Вернуть нельзя: записи с тех пор менялись",
  memoryRevertErrors: {
    limit_reached: "Вернуть как было нельзя: в памяти не хватит места. Удалите ненужные записи и повторите",
    duplicate: "Вернуть как было нельзя: одну из записей вы уже добавили заново. Удалите повтор и повторите",
  },
  agentPanelLauncher: "Агент",
  agentPanelOpen: "Открыть агента",
  agentPanelClose: "Закрыть панель агента",
  agentPanelLabel: "Панель агента",
  agentPanelChats: "Чаты",
  agentPanelBackToChat: "К чату",
  agentPanelBusy: "Агент отвечает",
  agentPanelToolUnavailable: "Инструмент недоступен на этой странице",
  widgets: {
    answeredByMessage: "Ответ дан сообщением",
    submit: "Готово",
    choose: "Выберите вариант или ответьте своими словами",
    ratingStars: (value, total) => `Оценка ${value} из ${total}`,
    answerFailed: "Ответ не отправился, попробуйте ещё раз",
    notCurrentBranch: "Вопрос из другой ветки: ответить на него можно только там",
    fallback: "Ответьте сообщением",
    formRequired: "Обязательное поле",
    asked: "Агент задал вопрос",
    answerSent: "Ответ отправлен",
    formSubmit: "Отправить",
    choiceRange: (min, max) => (min === max ? `Выберите ${min}` : `Выберите от ${min} до ${max}`),
    formOutOfRange: (min, max) =>
      min !== undefined && max !== undefined ? `Допустимо от ${min} до ${max}` : min !== undefined ? `Допустимо от ${min}` : `Допустимо до ${max}`,
    formNotNumber: "Введите число",
    formNotDate: "Введите дату",
    formTooLong: (max) => `Не длиннее ${max} знаков`,
    alreadyAnswered: "На этот вопрос уже ответили",
    answerRejected: "Такой ответ не подходит, ответьте сообщением",
    answerCheckTimeout: "Не удалось проверить ответ, попробуйте ещё раз",
  },
  diagram: {
    loading: "Схема рисуется…",
    failed: "Схему не удалось нарисовать, показан её текст",
    open: "Открыть схему",
  },
  demo: {
    loading: "Готовлю демонстрацию…",
    title: "Живая демонстрация",
    tooLarge: "Демонстрация слишком большая для запуска, показан её код",
    unfinished: "Демонстрация не дописана, показан её код",
    leftPage: "Демонстрация попыталась открыть другую страницу и остановлена, показан её код",
    externalContent: "В этом чате есть текст из интернета или файлов, поэтому демонстрации не запускаются — показан код",
  },
  images: {
    loading: "Картинка создаётся…",
    failed: "Картинка не создалась",
    stopped: "Создание остановлено",
    open: "Открыть картинку",
  },
  videos: {
    play: "Смотреть видео",
    from: (time) => `с ${time}`,
    fullscreen: "На весь экран",
  },
  viewer: {
    close: "Закрыть",
    next: "Следующая",
    previous: "Предыдущая",
    fit: "Вписать в экран",
    counter: (position, total) => `${position} из ${total}`,
  },
  voice: {
    diagramOnScreen: "схема на экране",
    videoOnScreen: "видео на экране",
    widgetChoices: (question, options) => `${question} Варианты: ${options.join(", ")}.`,
    widgetOnScreen: (title) => `${title ? `${title}. ` : ""}Ответьте на экране или голосом.`,
  },
};

const englishPeriodPhrases = { month: " for the month", week: " for the week", day: " for the day", none: "" } as const;
function englishPeriodPhrase(info: SpendingInfo): string {
  if (info.period === "rolling") return info.hours ? ` for ${info.hours} h` : "";
  return englishPeriodPhrases[info.period];
}
const englishScopePhrase = (info: SpendingInfo) => (info.scope === "chat" ? " of this chat" : info.scope === "service" ? " of the service" : "");
function englishResetDate(moment: Date, timeZone = "UTC", withTime = false): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: zone, ...(withTime && { hour: "2-digit", minute: "2-digit" }) }).format(moment);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}
const englishResetPhrase = (info: SpendingInfo) => (info.resetsAt ? `, renews ${englishResetDate(info.resetsAt, info.timeZone, info.period === "rolling")}` : "");
const englishCount = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const englishMergeDate = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Полный английский словарь чата: `<ChatLabelsProvider labels={englishLabels}>`. Свои поправки — поверх него. */
export const englishLabels: ResolvedChatLabels = {
  locale: "en",
  welcome: { title: "Where shall we start?", description: "Ask a question or describe a task." },
  ...englishWorkLabels,
  workView: englishWorkViewLabels,
  composerSettings: { levels: { off: "Off", on: "On", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", max: "Max" }, model: "Model", reasoning: "Reasoning", tools: "Tools", settings: "Response settings", done: "Done", via: "Via", search: "Find model", showReasoning: "Show reasoning", project: "Project", file: "File", image: "Image", textModels: "Text tasks", imageModels: "Text and images", models: "Models", noResults: "No results", price: "USD per million tokens", input: "input", output: "output" },
  composerPlaceholder: "Write a message",
  composerLabel: "Message",
  send: "Send",
  stop: "Stop",
  copyAnswer: "Copy answer",
  copied: "Copied",
  copyCode: "Copy code",
  reasoningRunning: "Thinking…",
  reasoningDone: (seconds) => `Thought for ${seconds} s`,
  thinkingPhrases: [
    "Thinking…",
    "Figuring it out…",
    "Sorting things out…",
    "Checking details…",
    "Gathering thoughts…",
    "Weighing options…",
    "Looking for the best move…",
    "Double-checking…",
    "Putting the picture together…",
    "Mulling it over…",
  ],
  thinkingElapsed: (seconds) => {
    if (seconds < 60) return `${seconds} s`;
    const rest = seconds % 60;
    return rest === 0 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 60)} min ${rest} s`;
  },
  toolRunning: (toolName) => `${toolName}: running`,
  toolDone: (toolName) => `${toolName}: done`,
  toolError: (toolName) => `${toolName}: error`,
  screenshotAlt: "Page screenshot",
  screenshotUnavailable: "The screenshot didn’t load.",
  answerStopped: "Stopped",
  answerInterrupted: "Reply interrupted",
  answerEmpty: "The model gave no reply",
  externalImageLink: "image",
  answerCutByLength: "The reply was cut off for length",
  answerEdited: "Edited by a person",
  answerUndelivered: "Not delivered",
  toolOutputEdited: "Result edited",
  editAnswer: "Edit reply",
  history: { loading: "Loading details…", failed: "Could not load", older: "Earlier messages" },
  retry: "Retry",
  reconnecting: "Reconnecting…",
  connectionLost: "No connection to the server",
  chatNotFound: "Chat not found",
  errors: {
    overloaded: "The model is overloaded, please try again",
    rate_limited: "Too many requests, please try again in a minute",
    insufficient_funds: "The provider account is out of money",
    invalid_key: "The provider key doesn’t work",
    context_overflow: "The conversation doesn’t fit into the model. Start a new chat or pick a model with a bigger window",
    other: "Something went wrong, please try again",
    signed_out: "You’ve been signed out. Please sign in again",
    too_many_turns: "Replies are already running in other chats. Wait for one to finish and send again",
    forbidden_origin: "The chat server doesn’t accept messages from this page. Let the site admin know",
  },
  reasoningLevels: { off: "Off", on: "On", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", max: "Max" },
  historyCompacted: "History compacted",
  historyCompactedHint: "Instead of the messages above, the model sees this summary. The messages themselves are still here.",
  branchPosition: (position, count) => `Version ${position} of ${count}`,
  previousBranch: "Previous version",
  nextBranch: "Next version",
  regenerate: "Regenerate",
  editMessage: "Edit message",
  saveEdit: "Send",
  cancelEdit: "Cancel",
  editErrors: {
    busy: "A reply is still running. Wait for it to finish and send again",
    offline: "No connection to the server. Your text is kept in the field",
    rejected: "The server didn’t accept the edit. Your text is kept in the field",
    spendingLimit: "The spending limit is used up. Your text is kept in the field",
    signedOut: "You’ve been signed out. Sign in again. Your text is kept in the field",
    tooManyTurns: "Replies are already running in other chats. Your text is kept in the field",
    forbiddenOrigin: "The chat server doesn’t accept messages from this page. Your text is kept in the field",
  },
  editMessageLimit: "The message limit is used up. Your text is kept in the field",
  modelChoiceFailed: "Couldn’t change the model",
  modelMenuFailed: "The model list didn’t load",
  voiceStart: "Dictate",
  voiceStop: "Stop dictation",
  voiceConnecting: "Connecting to the microphone…",
  voicePolishing: "Tidying up the text…",
  voiceErrors: {
    permission_denied: "No access to the microphone. Allow it in your browser settings",
    no_microphone: "No microphone found",
    unsupported: "This browser can’t record audio",
    network: "Connection lost, dictation stopped",
    service_unavailable: "Speech recognition isn’t available",
    other: "Couldn’t start dictation",
    rate_limited: "Too many dictations in a row, please try again in a minute",
    time_limit: (seconds) =>
      `Recording stopped: the limit is ${seconds % 60 === 0 ? englishCount(seconds / 60, "minute", "minutes") : englishCount(seconds, "second", "seconds")}`,
    limit: "Spending limit reached, dictation is unavailable",
    forbidden: "No access to dictation",
    too_long: "The recording is too long",
  },
  voiceDialog: {
    start: "Voice mode",
    exit: "Exit",
    voiceMenu: "Voice",
    states: {
      off: "Voice mode is off",
      connecting: "Connecting…",
      listening: "Listening",
      thinking: "Thinking",
      speaking: "Speaking",
      interrupted: "You interrupted",
      error: "Something went wrong",
    },
    errors: {
      microphone_denied: "No access to the microphone. Allow it in your browser settings",
      microphone_missing: "Microphone unavailable: you need a microphone, https and an up-to-date browser",
      network: "Connection lost, voice mode stopped",
      service_unavailable: "The voice service isn’t available",
      recognition_lost: "Speech recognition dropped",
      speech_unavailable: "Voice playback isn’t available: replies come as text",
      limit: "The spending limit is used up",
      rate_limited: "Too many starts in a row, please try again in a minute",
      idle: "Voice mode turned off: no speech for a long time",
      backgrounded: "Voice mode turned off: the page went to the background",
    },
    interruptedMark: (spokenTail) => `You interrupted: spoken up to “${spokenTail}”`,
  },
  approvalRequested: (action) => `The agent wants to: ${action}`,
  approvalWaiting: "Waiting for your decision",
  approvalAllow: "Allow",
  approvalDeny: "Deny",
  approvalAlways: "Always in this chat",
  approvalFailed: "The answer didn’t reach the server, please try again",
  approvalSpendingLimit: "The spending limit is used up, you can’t answer right now",
  approvalBusy: "The chat is busy with another turn, please try again",
  approvalTooManyTurns: "Replies are already running in other chats, please try a bit later",
  approvalAllowedMark: "Allowed",
  approvalAlwaysMark: "Allowed in this chat",
  approvalDeniedMark: "Denied",
  approvalAnnouncement: "The agent is waiting for your decision",
  spendingWarning: (info) => {
    const percent = Math.min(99, Math.floor((info.share ?? 0) * 100 + 1e-6));
    return `${percent}% of the limit${englishScopePhrase(info)}${englishPeriodPhrase(info)} used`;
  },
  spendingExhausted: (info) => {
    if (info.reason === "blocked") return "New replies are paused for you";
    if (info.reason === "reserve") return `Not enough left in the limit${englishScopePhrase(info)}${englishPeriodPhrase(info)} for a new reply${englishResetPhrase(info)}`;
    return `The limit${englishScopePhrase(info)}${englishPeriodPhrase(info)} is used up${englishResetPhrase(info)}`;
  },
  spendingMessagesLeft: (remaining) => `${englishCount(remaining, "message", "messages")} left`,
  spendingMessagesExhausted: (info) => `The message limit is used up${englishResetPhrase(info)}`,
  chatListHeading: "Chats",
  chatListNewChat: "New chat",
  chatListUntitled: "New chat",
  chatListOrigin: { telegram: "Telegram", vk: "VK", max: "MAX" },
  chatListClosed: "Closed",
  chatListLoading: "Loading chats…",
  chatListLoadFailed: "The chat list didn’t load",
  chatListCreateFailed: "Couldn’t create a chat",
  chatListRenameFailed: "Couldn’t rename the chat",
  chatListDeleteFailed: "Couldn’t delete the chat",
  chatListRowMenu: (title) => `Actions for chat “${title}”`,
  chatListRename: "Rename",
  chatListRenameField: "Chat name",
  chatListDelete: "Delete",
  chatListDeleteTitle: "Delete chat?",
  chatListDeleteBody: (title) => `Chat “${title}” and all its messages will be deleted for good.`,
  chatListDeleteConfirm: "Delete",
  chatListDeleteCancel: "Cancel",
  memoryHeading: "Memory",
  memoryCount: (total, limit) => `Notes: ${total} of ${limit}`,
  memoryShownHint: (shown, total) => `Shown to the agent: ${shown} of ${total}. It finds the rest by searching.`,
  memoryAdd: "Add",
  memoryClearAll: "Erase all memory",
  memoryLoading: "Loading memory…",
  memoryEmpty: "Memory is empty. The agent remembers important things as you talk, and you can add a note yourself.",
  memoryUnavailable: "Memory isn’t turned on in this app",
  memoryLoadFailed: "Memory didn’t load",
  memoryEdit: "Edit",
  memoryDelete: "Delete",
  memoryEditNote: (content) => `Edit note “${content}”`,
  memoryDeleteNote: (content) => `Delete note “${content}”`,
  memoryGroupLabel: (name, count) => `${name}, notes: ${count}`,
  memoryNewNoteTitle: "New note",
  memoryEditNoteTitle: "Edit note",
  memoryPathField: "Section",
  memoryPathHint: "Up to three levels separated by “/”, for example: About me / Work",
  memoryContentField: "Note",
  memorySave: "Save",
  memoryCancel: "Cancel",
  memoryFieldErrors: {
    pathRequired: "Enter a section",
    pathTooMany: "No more than three section levels",
    pathTooLong: "Section names: up to 60 characters",
    contentRequired: "Write the note text",
    contentTooLong: "Notes: up to 500 characters",
  },
  memoryErrors: {
    not_found: "This note is gone. The list is updated",
    stale_version: "The note changed elsewhere. The list is updated: check it and try again",
    limit_reached: "Memory is full. Delete notes you don’t need and try again",
    duplicate: "This note already exists",
    invalid: "The server didn’t accept the note. Check the sections and text",
    conflict: "It can’t be undone anymore: the notes have changed since. The list is updated",
    unavailable: "Memory isn’t turned on in this app",
    other: "Couldn’t do that, please try again",
  },
  memoryDeleteTitle: "Delete note?",
  memoryDeleteBody: (content) => `Note “${content}” will be deleted for good.`,
  memoryClearTitle: "Erase all memory?",
  memoryClearBody: (total) => `All notes (${total}) will be deleted for good. The agent will forget everything it knew about you.`,
  memoryConfirmDelete: "Delete",
  memoryConfirmClear: "Erase all",
  memoryConfirmCancel: "Cancel",
  memoryMergesHeading: "Merged",
  memoryMergeDate: (finishedAt) => englishMergeDate.format(finishedAt),
  memoryMergeBefore: "Before",
  memoryMergeAfter: "After",
  memoryMergeRevert: "Undo",
  memoryMergeRevertFor: (when) => `Undo (${when})`,
  memoryMergeNotRevertible: "Can’t undo: the notes have changed since",
  memoryRevertErrors: {
    limit_reached: "Can’t undo: there’s not enough room in memory. Delete notes you don’t need and try again",
    duplicate: "Can’t undo: you’ve already added one of the notes again. Delete the duplicate and try again",
  },
  agentPanelLauncher: "Agent",
  agentPanelOpen: "Open agent",
  agentPanelClose: "Close agent panel",
  agentPanelLabel: "Agent panel",
  agentPanelChats: "Chats",
  agentPanelBackToChat: "Back to chat",
  agentPanelBusy: "The agent is replying",
  agentPanelToolUnavailable: "This tool isn’t available on this page",
  widgets: {
    answeredByMessage: "Answered in a message",
    submit: "Done",
    choose: "Pick an option or answer in your own words",
    ratingStars: (value, total) => `Rating ${value} of ${total}`,
    answerFailed: "The answer wasn’t sent, please try again",
    notCurrentBranch: "This question is from another version: you can only answer it there",
    fallback: "Answer in a message",
    formRequired: "Required field",
    asked: "The agent asked a question",
    answerSent: "Answer sent",
    formSubmit: "Send",
    choiceRange: (min, max) => (min === max ? `Pick ${min}` : `Pick ${min} to ${max}`),
    formOutOfRange: (min, max) =>
      min !== undefined && max !== undefined ? `Allowed from ${min} to ${max}` : min !== undefined ? `Allowed from ${min}` : `Allowed up to ${max}`,
    formNotNumber: "Enter a number",
    formNotDate: "Enter a date",
    formTooLong: (max) => `Up to ${max} characters`,
    alreadyAnswered: "This question has already been answered",
    answerRejected: "That answer doesn’t fit, please answer in a message",
    answerCheckTimeout: "Couldn’t check the answer, please try again",
  },
  diagram: { loading: "Drawing the diagram…", failed: "Couldn’t draw the diagram, showing its text", open: "Open diagram" },
  demo: {
    loading: "Preparing the demo…",
    title: "Live demo",
    tooLarge: "The demo is too large to run, showing its code",
    unfinished: "The demo isn’t finished, showing its code",
    leftPage: "The demo tried to open another page and was stopped, showing its code",
    externalContent: "This chat contains text from the web or files, so demos don’t run — showing the code",
  },
  images: { loading: "Creating the image…", failed: "The image wasn’t created", stopped: "Creation stopped", open: "Open image" },
  videos: { play: "Watch video", from: (time) => `from ${time}`, fullscreen: "Full screen" },
  viewer: { close: "Close", next: "Next", previous: "Previous", fit: "Fit to screen", counter: (position, total) => `${position} of ${total}` },
  voice: {
    diagramOnScreen: "diagram on screen",
    videoOnScreen: "video on screen",
    widgetChoices: (question, options) => `${question} Options: ${options.join(", ")}.`,
    widgetOnScreen: (title) => `${title ? `${title}. ` : ""}Answer on screen or by voice.`,
  },
};

/**
 * Тексты закрытых «Стопом» вызовов: те же, что записывает сервер (core: `HANGING_TOOL_CALL_REASON`, `INTERRUPTED_REASON`,
 * `RESULT_UNKNOWN_REASON`).
 * Не надписи для человека, а часть ответа; лежат здесь, потому что надписи в коде вне словаря запрещены.
 */
export const stoppedToolCallReasons = {
  hanging: "Вызов инструмента оборвался до результата: действие могло выполниться частично или целиком. Не повторяй его, не проверив, что уже сделано",
  interrupted: "Ход прерван раньше, чем пользователь ответил на запрос. Действие не выполнялось.",
  resultUnknown: "Пользователь разрешил действие, но ход прервался до результата. Неизвестно, выполнено оно или нет; не повторяй его, не проверив.",
} as const;

/** Время без слов для словаря на другом языке: «0:12», «1:05». */
const clockElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const LabelsContext = createContext<ResolvedChatLabels>(russianLabels);

export function ChatLabelsProvider({ labels, children }: { labels: ChatLabels; children: ReactNode }) {
  const resolved = useMemo(
    () => ({
      ...labels,
      history: { ...(labels.locale?.startsWith("en") ? englishLabels : russianLabels).history, ...labels.history },
      welcome: { ...(labels.locale?.startsWith("en") ? englishLabels : russianLabels).welcome, ...labels.welcome },
      composerSettings: { ...(labels.locale?.startsWith("en") ? englishLabels : russianLabels).composerSettings, ...labels.composerSettings },
      externalImageLink: labels.externalImageLink ?? russianLabels.externalImageLink,
      answerCutByLength: labels.answerCutByLength ?? russianLabels.answerCutByLength,
      answerEdited: labels.answerEdited ?? russianLabels.answerEdited,
      answerUndelivered: labels.answerUndelivered ?? russianLabels.answerUndelivered,
      toolOutputEdited: labels.toolOutputEdited ?? russianLabels.toolOutputEdited,
      editAnswer: labels.editAnswer ?? russianLabels.editAnswer,
      steeringPending: labels.steeringPending ?? russianLabels.steeringPending,
      spendingMessagesLeft: labels.spendingMessagesLeft ?? russianLabels.spendingMessagesLeft,
      spendingMessagesExhausted: labels.spendingMessagesExhausted ?? russianLabels.spendingMessagesExhausted,
      editMessageLimit: labels.editMessageLimit ?? russianLabels.editMessageLimit,
      thinkingPhrases: labels.thinkingPhrases ?? (labels.reasoningRunning === russianLabels.reasoningRunning ? russianLabels.thinkingPhrases : []),
      thinkingElapsed: labels.thinkingElapsed ?? (labels.reasoningRunning === russianLabels.reasoningRunning ? russianLabels.thinkingElapsed : clockElapsed),
      widgets: { ...russianLabels.widgets, ...labels.widgets },
      diagram: { ...russianLabels.diagram, ...labels.diagram },
      demo: { ...russianLabels.demo, ...labels.demo },
      images: { ...russianLabels.images, ...labels.images },
      videos: { ...russianLabels.videos, ...labels.videos },
      viewer: { ...russianLabels.viewer, ...labels.viewer },
      voice: { ...russianLabels.voice, ...labels.voice },
      // Новые подписи ошибок голоса — на языке словаря, если свой словарь их не знает.
      voiceErrors: { ...(labels.locale?.startsWith("en") ? englishLabels : russianLabels).voiceErrors, ...labels.voiceErrors },
      helpers: { ...russianLabels.helpers, ...labels.helpers },
      tasks: { ...russianLabels.tasks, ...labels.tasks },
      notices: { ...russianLabels.notices, ...labels.notices },
      messengerStatus: { ...russianLabels.messengerStatus, ...labels.messengerStatus },
      workView: { ...russianLabels.workView, ...labels.workView },
    }),
    [labels],
  );
  return <LabelsContext.Provider value={resolved}>{children}</LabelsContext.Provider>;
}

export function useChatLabels(): ResolvedChatLabels {
  return useContext(LabelsContext);
}
