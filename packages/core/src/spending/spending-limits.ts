/**
 * За какой срок копится расход: календарный месяц, неделя или сутки (по поясу лимитов, без него — по UTC), скользящее
 * окно в N часов от первого запроса после конца прошлого окна (`rolling`) либо навсегда.
 */
export type SpendingPeriod = "month" | "week" | "day" | "rolling" | "none";

/** Чей расход ограничен: человека (все его чаты), одного чата или всего сервиса (все люди вместе). */
export type SpendingScope = "user" | "chat" | "service";

/** Почему ход не начат: лимит исчерпан, человек заблокирован, остаток меньше запаса на ход. */
export type SpendingRefusalReason = "limit" | "blocked" | "reserve";

/** Чем меряется окно лимита: доллары или сообщения человека. */
export type SpendingUnit = "usd" | "messages";

/** Одно окно лимита для экрана: доля и время сброса, без долларов; у окна сообщений — и сами числа. */
export interface SpendingWindowStatus {
  /** Имя окна из настроек лимитов. */
  id: string;
  scope: SpendingScope;
  period: SpendingPeriod;
  /** Длина скользящего окна в часах (`period: "rolling"`). */
  hours?: number;
  state: SpendingState;
  /** Доля израсходованного, 0…1 и больше при перерасходе. */
  share: number;
  /** Когда окно обнулится (ISO); `null` — никогда или скользящее окно ещё не началось. */
  resetsAt: string | null;
  /** Чем меряется окно. Есть, только если среди окон есть окна сообщений; нет — деньги. */
  unit?: SpendingUnit;
  /** Окно сообщений: лимит, сколько сообщений уже отправлено и сколько осталось. Числа не секретны. */
  limit?: number;
  used?: number;
  remaining?: number;
}

export type SpendingState = "ok" | "warning" | "exhausted";

/**
 * Состояние лимитов чата для экрана. Долларов здесь нет: человек видит долю и дату обновления,
 * суммы приложение читает у расширения лимитов само.
 */
export interface SpendingStatus {
  state: SpendingState;
  /** Область самого тесного лимита; у состояния `ok` может отсутствовать. */
  scope?: SpendingScope;
  period?: SpendingPeriod;
  /** Доля израсходованного, 0…1 и больше при перерасходе. */
  share?: number;
  /** Когда расход обнулится (ISO); `null` — никогда (лимит без периода). */
  resetsAt?: string | null;
  /** Пояс, по которому режутся сутки и месяцы (IANA); по нему экран показывает дату обновления. Нет — UTC. */
  timeZone?: string;
  /** Имя самого тесного окна (лимиты с окнами). */
  windowId?: string;
  /** Длина самого тесного окна в часах, если оно скользящее. */
  hours?: number;
  /** Почему ход не начнётся, если `state` — `exhausted`: лимит, блокировка или остаток меньше запаса на старт. */
  reason?: SpendingRefusalReason;
  /** Человек заблокирован: ходы не начинаются, пока его не разблокируют. */
  blocked?: boolean;
  /** Все окна с лимитом по отдельности (лимиты с окнами). */
  windows?: SpendingWindowStatus[];
  /** Самое тесное окно — окно сообщений (`messages`); у денег поля нет. */
  unit?: SpendingUnit;
  /** Сколько сообщений осталось в самом тесном окне, если оно — окно сообщений. */
  remaining?: number;
}

/**
 * Потолки одного хода. Проверяются между шагами: дошёл ход до потолка — следующий шаг идёт без инструментов и с
 * просьбой подвести итог, ответ кончается итогом, а не обрывом. Шаг, начатый до потолка, доделывается, поэтому
 * итог хода может немного перейти потолок.
 */
export interface TurnSpendingRules {
  /** Потолок стоимости хода в долларах, по ценам профиля модели. */
  maxCostUsd?: number;
  /** Потолок вызовов инструментов за ход. */
  maxToolCalls?: number;
}

/**
 * Лимиты расходов (расширение `@ykurilov/agent-chat-limits`). Ядро зовёт проверку до начала хода и ничего не знает
 * о деньгах: токены оно только записывает в журнал расхода.
 */
export interface SpendingLimits {
  /**
   * Проверка до хода. Бросает `SpendingLimitReachedError`, если лимит исчерпан; любая другая ошибка тоже
   * останавливает ход: лучше отказать, чем пропустить. `pendingUsd` — заказанное, но ещё не записанное в журнал
   * (картинки параллельных вызовов, которые идут прямо сейчас): лимит считает его потраченным — `user` в бюджет
   * человека, `chat` в бюджет этого чата.
   */
  assertWithinLimit(input: { userId: string; chatId: string; pendingUsd?: { user: number; chat: number } }): Promise<void>;
  status(input: { userId: string; chatId: string }): Promise<SpendingStatus>;
  /**
   * Потолки хода, который сейчас начнётся: служба чата спрашивает их после проверки лимита, перед каждым ходом.
   * Ошибка — ход не начинается. Нет метода или `undefined` — у хода только лимит шагов.
   */
  turnRules?(input: { userId: string; chatId: string }): Promise<TurnSpendingRules | undefined>;
  /**
   * Расход записан в журнал (после хода агента, генерации картинки): лимиты сверяют пороги и шлют свои события. Его
   * не ждут; ошибка уходит в журнал сервера.
   */
  afterSpending?(input: { userId: string; chatId: string }): Promise<void>;
  /**
   * Счёт сообщений: служба чата зовёт его при отправке и правке сообщения человека, после проверки хода и до записи.
   * Окно сообщений исчерпано — `SpendingLimitReachedError` с `unit: "messages"`. Нет метода — сообщения не считаются.
   * Возвращает, как отдать место назад: служба зовёт это, если сообщение так и не записалось. Нечего отдавать — `undefined`.
   */
  takeMessage?(input: { userId: string; chatId: string }): Promise<(() => Promise<void>) | undefined>;
  /**
   * Чат удалён: лимиты стирают то, что хранили про этот чат (окна области `chat`). Расход в журнале остаётся.
   * Ошибка удаление не отменяет — чата уже нет — и уходит в журнал сервера.
   */
  chatDeleted?(input: { userId: string; chatId: string }): Promise<void>;
  /**
   * Часовой пояс лимитов (IANA). Та же настройка для сегодняшней даты агента: служба чата берёт его, если
   * `agent.timeZone` не задан. Нет — сутки по UTC, дата агента по поясу сервера.
   */
  readonly timeZone?: string;
}

/** Лимит расходов исчерпан: ход не начат, ничего не записано. */
export class SpendingLimitReachedError extends Error {
  readonly scope: SpendingScope;
  readonly period: SpendingPeriod;
  readonly resetsAt: string | null;
  /** Пояс лимитов, если задан: по нему экран показывает дату обновления. */
  readonly timeZone?: string;
  /** Почему отказ; нет — исчерпан лимит (`limit`). */
  readonly reason?: SpendingRefusalReason;
  /** Имя окна, которое не пустило ход (лимиты с окнами). */
  readonly windowId?: string;
  /** Длина этого окна в часах, если оно скользящее. */
  readonly hours?: number;
  /** Чем меряется исчерпанное окно; нет — деньгами (`usd`). */
  readonly unit?: SpendingUnit;

  constructor(details: {
    scope: SpendingScope;
    period: SpendingPeriod;
    resetsAt: string | null;
    timeZone?: string;
    reason?: SpendingRefusalReason;
    windowId?: string;
    hours?: number;
    unit?: SpendingUnit;
  }) {
    super(details.reason === "blocked" ? "Расходы человека заблокированы" : details.unit === "messages" ? "Лимит сообщений исчерпан" : "Лимит расходов исчерпан");
    this.name = "SpendingLimitReachedError";
    this.scope = details.scope;
    this.period = details.period;
    this.resetsAt = details.resetsAt;
    if (details.timeZone !== undefined) this.timeZone = details.timeZone;
    if (details.reason !== undefined) this.reason = details.reason;
    if (details.windowId !== undefined) this.windowId = details.windowId;
    if (details.hours !== undefined) this.hours = details.hours;
    if (details.unit !== undefined) this.unit = details.unit;
  }
}
