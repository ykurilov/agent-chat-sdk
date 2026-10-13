/**
 * Фразы бота по умолчанию. Собраны в одном месте, чтобы тексты не расползались по модулям. Приложение меняет любую
 * через `texts` у `createMessengers` или у бота; пустая фраза (или фраза-функция, вернувшая "") — бот молчит.
 */
export const defaultMessengerTexts = {
  hello: "Здравствуйте! Чем помочь?",
  howToConnect: "Чтобы я отвечал, подключите этот аккаунт: в приложении нажмите «Подключить» и откройте ссылку.",
  linked: "Готово: аккаунт подключён.",
  linkFailed: "Код не подошёл или устарел. Возьмите новую ссылку в приложении.",
  /** Код другого пользователя, а этот аккаунт мессенджера уже привязан: привязка не переносится. */
  linkTaken: "Этот аккаунт уже подключён к другому пользователю. Сначала отключите его там в приложении, потом возьмите новую ссылку.",
  /** Без службы чата: ответ привязанному человеку на любое сообщение, команду и кнопку. */
  notifyOnly: "Сюда я только присылаю уведомления. Отвечать на сообщения не умею.",
  helpSingle: "Задайте вопрос сообщением. /stop — остановить ответ.",
  helpMany: "Задайте вопрос сообщением. /new — новый чат, /chats — последние чаты, /stop — остановить ответ.",
  helpGroup: "Упомяните меня или ответьте на моё сообщение. /connect — подключить бота, /disconnect — отключить.",
  /** Итог на месте строки статуса. Пустая — статус удаляется (если адаптер умеет `deleteMessage`). */
  stopped: "Остановил.",
  nothingToStop: "Сейчас ничего не идёт.",
  newChat: "Начали новый чат.",
  /** Над кнопками: без текста сообщение не отправить, поэтому пустая фраза здесь — фраза по умолчанию. */
  chatsTitle: "Последние чаты:",
  noChats: "Чатов пока нет.",
  chatSelected: (title: string) => `Продолжаем чат «${title}».`,
  untitledChat: "Без названия",
  closedChat: (title: string) => `${title} · закрыт`,
  chatListForbidden: "Список чатов здесь недоступен.",
  voiceForbidden: "Голосовые в этом чате недоступны. Напишите текстом.",
  filesForbidden: "Файлы в этом чате недоступны. Напишите текстом.",
  alreadyAnswered: "Уже отвечено.",
  accepted: "Принято.",
  failed: "Не получилось. Попробуйте ещё раз.",
  /** Итог на месте строки статуса. Пустая — статус удаляется (если адаптер умеет `deleteMessage`). */
  answerFailed: "Не получилось ответить. Попробуйте ещё раз.",
  limitReached: (limit: { resetsAt: string | null; timeZone?: string; unit?: "usd" | "messages" }) => {
    const reached = limit.unit === "messages" ? "Лимит сообщений исчерпан." : "Лимит расходов исчерпан.";
    return limit.resetsAt === null ? reached : `${reached} Снова можно будет писать ${resetMoment(limit.resetsAt, limit.timeZone)}.`;
  },
  tooManyTurns: "Сейчас идёт слишком много ответов. Подождите и напишите ещё раз.",
  /** Над кнопками: без текста сообщение не отправить, поэтому пустая фраза здесь — фраза по умолчанию. */
  approvalQuestion: (title: string) => `Нужно ваше разрешение: ${title}.`,
  allow: "Разрешить",
  deny: "Запретить",
  allowAlways: "Разрешать всегда",
  approvalByWords: "Ответьте «да» или «нет».",
  answerByMessage: "Ответьте сообщением.",
  openInApp: "Открыть в приложении",
  openChat: "Открыть чат",
  openLink: (url: string) => `Откройте: ${url}`,
  /** Вместо живой демонстрации (блок ```html-demo): она запускается только на сайте. Пустая — блок убирается. */
  liveDemoOnSite: "Демонстрация доступна на сайте.",
  /** Итог на месте строки статуса. Пустая — статус удаляется (если адаптер умеет `deleteMessage`). */
  done: "Готово",
  rewritingAnswer: "Пишу ответ заново…",
  chooseMany: "Выберите варианты и нажмите «Готово».",
  chooseAtMost: (max: number) => `Можно выбрать не больше ${max}.`,
  requiredField: "обязательно",
  taskReady: (title: string) => `Задача готова: ${title}`,
  taskReadyUntitled: "Задача готова",
  cancelTask: "Отменить задачу",
  taskRunning: (title: string) => `Задача «${title}» выполняется.`,
  taskCanceled: "Задача отменена.",
  /** Над кнопками: без текста сообщение не отправить, поэтому пустая фраза здесь — фраза по умолчанию. */
  taskApprovalQuestion: (task: string, action: string) => `Задача «${task}» ждёт вашего разрешения: ${action}.`,
  // Группы
  writeInPrivate: "Пишите мне в личные сообщения.",
  connectHint: "Чтобы я отвечал в группе, напишите /connect.",
  groupConnected: (name: string) => `Подключено. Расходы на ${name}.`,
  groupConnectedPlain: "Подключено.",
  groupRefused: "В этой группе я не отвечаю.",
  groupNeedsLink: "Сначала подключите свой аккаунт в личных сообщениях со мной.",
  groupDisconnected: "Отключено. Больше не отвечаю в этой группе.",
  groupOnlyConnector: "Это может сделать только тот, кто подключил бота.",
  onlyPayer: (name: string) => `Подтвердить может только ${name}.`,
  payerFallback: "тот, кто подключил бота",
  stopNotYours: "Остановить ответ может только тот, кто его попросил, или тот, кто подключил бота.",
  memberLimit: "Слишком много обращений. Попробуйте через час.",
  // Файлы и голос
  filesOff: "Файлы здесь не принимаю. Напишите текстом.",
  fileTooBig: (limitMb: number) => `Файл больше ${limitMb} МБ — такой не принять.`,
  /** `reason` — код отказа `ingestFile`; незнакомый код человеку не показываем. */
  fileRefused: (reason: string) => (fileRefusals[reason] ? `Файл не принят: ${fileRefusals[reason]}.` : "Файл не принят."),
  voiceTooLong: "Голосовое слишком длинное. Запишите покороче или напишите текстом.",
  voiceOff: "Голосовые здесь не распознаю. Напишите текстом.",
  voiceLimit: "Лимит распознавания голоса исчерпан. Напишите текстом.",
  voiceFailed: "Не получилось распознать голосовое. Напишите текстом.",
  voiceMark: "голосовое",
};

/**
 * Фразы по умолчанию бота без службы чата (`service` не передан): они не обещают разговор. Свои `texts` общие и у бота
 * главнее их, как и фраз по умолчанию.
 */
export const defaultMessengerTextsWithoutChat = {
  linked: "Готово: аккаунт подключён.",
  howToConnect: "Чтобы получать сюда уведомления, подключите этот аккаунт: в приложении нажмите «Подключить» и откройте ссылку.",
} satisfies Partial<typeof defaultMessengerTexts>;

/** Все фразы бота: строки и фразы-функции с данными (название чата, лимит, размер файла). */
export type MessengerTexts = Readonly<typeof defaultMessengerTexts>;

/** Фразы конкретного бота: по мессенджеру и номеру бота. */
export type MessengerTextsOf = (bot: { messenger: string; botId: string }) => MessengerTexts;

/** Внутри пакета — короткое имя для фраз по умолчанию. */
export const messengerTexts: MessengerTexts = defaultMessengerTexts;

/** Модуль собран без поиска фраз (тесты модуля): у всех ботов фразы по умолчанию. */
export const defaultTextsOf: MessengerTextsOf = () => defaultMessengerTexts;

/**
 * Фразы каждого бота: по умолчанию ← умолчания режима (`modeDefaults`, у бота без чата) ← общие `texts` из
 * `createMessengers` ← `texts` бота. Незаданная фраза
 * (`undefined`) берётся с уровня ниже; пустая строка — заданная фраза «молчать». Кроме фраз над кнопками
 * (`chatsTitle`, `approvalQuestion`, `taskApprovalQuestion`): для них пустая — фраза уровнем ниже.
 */
export function createTextsLookup(
  bots: ReadonlyArray<{ messenger: string; botId: string; texts?: Partial<MessengerTexts> }>,
  general?: Partial<MessengerTexts>,
  modeDefaults?: Partial<MessengerTexts>,
): MessengerTextsOf {
  const shared = mergeTexts(mergeTexts(defaultMessengerTexts, modeDefaults), general);
  const byBot = new Map(bots.map((bot) => [`${bot.messenger}/${bot.botId}`, mergeTexts(shared, bot.texts)]));
  return (bot) => byBot.get(`${bot.messenger}/${bot.botId}`) ?? shared;
}

/** Фразы сообщений с кнопками: без текста сообщение не отправить, поэтому пустая фраза здесь — фраза уровнем ниже. */
const unsilenceable = new Set<string>(["chatsTitle", "approvalQuestion", "taskApprovalQuestion"]);

function mergeTexts(base: MessengerTexts, overrides: Partial<MessengerTexts> | undefined): MessengerTexts {
  if (!overrides) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined || !Object.hasOwn(base, name)) continue;
    merged[name] = unsilenceable.has(name) ? orBase(value, base[name as keyof MessengerTexts]) : value;
  }
  return merged as MessengerTexts;
}

function orBase(value: unknown, base: unknown): unknown {
  if (typeof value === "function" && typeof base === "function") return (...args: unknown[]) => value(...args) || base(...args);
  return value || base;
}

/** Строка статуса по имени инструмента: пока модель работает, человек видит, чем она занята. */
const statusByTool: Record<string, string> = {
  web_search: "Ищу в интернете…",
  read_page: "Читаю страницу…",
  page_screenshot: "Смотрю страницу…",
  manage_memory: "Работаю с памятью…",
  search_earlier_conversation: "Ищу в старой переписке…",
};

/** Виджеты и подсказки — это вопрос человеку, а не работа: строки статуса у них нет. */
/** Причины отказа `ingestFile` (как `error.kind` у адреса загрузки вложений) — словами. */
const fileRefusals: Readonly<Record<string, string>> = {
  empty: "файл пустой",
  too_large: "файл слишком большой",
  unsupported_type: "такой вид файла не поддерживается",
  unreadable: "файл не читается",
  no_text: "в файле нет текста",
  too_much_text: "в файле слишком много текста",
  busy: "сейчас много загрузок, пришлите чуть позже",
  too_many_unsent: "слишком много неотправленных файлов",
};

const toolsWithoutStatus: ReadonlySet<string> = new Set(["ask_choice", "ask_multi_choice", "ask_rating", "ask_form", "suggest_replies"]);

export function statusLineFor(toolName: string): string | null {
  if (toolsWithoutStatus.has(toolName)) return null;
  if (Object.hasOwn(statusByTool, toolName)) return statusByTool[toolName] as string;
  if (toolName.startsWith("helper_")) return "Поручил помощнику…";
  return "Работаю…";
}

/** «1 ноября в 00:00» в поясе лимитов; пояс не задан — лимиты считаются по UTC, так и пишем. */
function resetMoment(resetsAt: string, timeZone: string | undefined): string {
  const at = new Date(resetsAt);
  const zone = timeZone ?? "UTC";
  const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: zone }).format(at);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(at);
  return `${date} в ${time}${timeZone === undefined ? " (UTC)" : ""}`;
}
