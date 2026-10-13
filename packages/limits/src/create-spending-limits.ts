import { SpendingLimitReachedError, resolveTimeZone } from "@ykurilov/agent-chat-core";
import type {
  ChatStorage,
  ModelCatalog,
  SpendingLimits,
  SpendingPeriod,
  SpendingRefusalReason,
  SpendingScope,
  SpendingState,
  SpendingStatus,
  SpendingWindowStatus,
  TurnSpendingRules,
  UsageFilter,
} from "@ykurilov/agent-chat-core";
import { limitStateStore } from "./limit-state";
import { giveBackMessageSlots, readMessageWindow, takeMessageSlots } from "./message-windows";
import type { MessageThresholdCrossing, MessageWindowReading } from "./message-windows";
import { calendarBounds } from "./spending-period";
import { normalizeWindows, validLimit } from "./spending-windows";
import type { SpendingSubject, SpendingWindow, SpendingWindowConfig } from "./spending-windows";
import { readWindow, windowStateKey } from "./window-reading";
import type { WindowReading, WindowState } from "./window-reading";

export type { CalendarWindowConfig, RollingWindowConfig, SpendingWindowConfig, TotalWindowConfig, WindowLimit } from "./spending-windows";

const DEFAULT_PERIOD: SpendingPeriod = "month";
const DEFAULT_WARN_AT = 0.8;
const DEFAULT_THRESHOLDS = [0.8, 1];
const STATE_SEVERITY: Record<SpendingState, number> = { ok: 0, warning: 1, exhausted: 2 };

/** Бюджеты в долларах. Нет поля — на эту область лимита нет. */
export interface SpendingBudget {
  user?: number;
  chat?: number;
}

/** Правила хода. */
export interface TurnRulesConfig {
  /** Запас на старт: новый ход начинается, только если в каждом окне осталось не меньше стольких долларов. */
  minRemainingUsd?: number;
  /**
   * Что делать ходу, который дошёл до остатка окна: `finish` (по умолчанию) — доделать, перерасход окна остаётся в нём
   * или переносится в следующее (`carryOverrun` окна); `stop` — закончить итогом, как на потолке хода.
   */
  overrun?: "finish" | "stop";
  /** Потолок стоимости одного хода в долларах. */
  maxCostUsd?: number;
  /** Потолок вызовов инструментов за ход. */
  maxToolCalls?: number;
}

/** Событие порога: расход окна дошёл до доли `threshold` лимита. Одно на порог в каждом окне. */
export interface SpendingThresholdEvent {
  windowId: string;
  scope: SpendingScope;
  period: SpendingPeriod;
  hours?: number;
  threshold: number;
  share: number;
  spentUsd: number;
  limitUsd: number;
  /** Начало окна (ISO); `null` — окно на всё время. */
  windowStart: string | null;
  resetsAt: string | null;
  /** Чей расход дошёл до порога: у окна сервиса — человек, на чьём расходе это случилось. */
  userId: string;
  chatId?: string;
}

/**
 * Событие порога окна сообщений: счёт сообщений дошёл до доли `threshold` лимита. Одно на порог в каждом окне; после
 * сброса окна или в новом окне — снова.
 */
export interface MessageThresholdEvent {
  windowId: string;
  scope: SpendingScope;
  period: SpendingPeriod;
  hours?: number;
  threshold: number;
  share: number;
  /** Сообщений в окне вместе с этим. */
  used: number;
  limit: number;
  remaining: number;
  /** Начало окна (ISO); `null` — окно на всё время. */
  windowStart: string | null;
  resetsAt: string | null;
  /** Чьё сообщение дошло до порога: у окна сервиса — человек, на чьём сообщении это случилось. */
  userId: string;
  chatId?: string;
}

/** Личные настройки человека. */
export interface UserSpendingSettings {
  blocked: boolean;
  /** Свои лимиты окон по имени: число долларов (у окна сообщений — сообщений) или `null` — без лимита. */
  limits: Record<string, number | null>;
}

/** Правка личных настроек: `"default"` у окна — снова общий лимит. */
export interface UserSpendingSettingsPatch {
  blocked?: boolean;
  limits?: Record<string, number | null | "default">;
}

export interface SpendingLimitsOptions {
  storage: ChatStorage;
  /**
   * Каталог, по которому сервис чата считает цену каждого хода. Здесь он нужен, чтобы при создании проверить,
   * что у всех пар «модель × провайдер» цена есть. Расход суммируется из записей журнала (доллары на момент хода),
   * поэтому смена цен и удаление модели из каталога прошлый расход не меняют.
   */
  catalog: ModelCatalog;
  /**
   * Окна лимитов: любое число одновременных окон, каждое со своей областью, сроком и лимитом. Ход начинается, только
   * если не исчерпано ни одно. Вместо `budget` и `period`.
   */
  windows?: readonly SpendingWindowConfig[];
  /**
   * Бюджет человека и чата (прежний способ, вместо `windows`). Функция от человека и чата: у разных тарифов разные
   * бюджеты. Зовётся на каждую проверку, так что смена тарифа действует сразу. Ошибка функции отклоняет ход.
   */
  budget?: (input: { userId: string; chatId?: string }) => SpendingBudget | Promise<SpendingBudget>;
  /** Период расхода к `budget`: одинаковый для обеих областей или свой для каждой. По умолчанию календарный месяц. */
  period?: SpendingPeriod | { user?: SpendingPeriod; chat?: SpendingPeriod };
  /**
   * Часовой пояс IANA (`Europe/Moscow`), по которому режутся сутки, недели и месяцы, если у окна нет своего. Та же
   * настройка — запасной пояс сегодняшней даты агента (если не задан `agent.timeZone`). Не задан — по UTC.
   * Не IANA-пояс — ошибка при создании.
   */
  timeZone?: string;
  /** С какой доли лимита показывать предупреждение, от 0 до 1 не включая границы. По умолчанию 0,8. */
  warnAt?: number;
  /** Пороги событий `onThreshold`: доли лимита больше 0 и не больше 1. По умолчанию 80% и 100%. */
  thresholds?: readonly number[];
  /**
   * Расход окна дошёл до порога (письмо, уведомление). Одно событие на порог в каждом окне; проверка — после
   * записи расхода (`afterSpending`). Ход обработчик не ждёт, ошибка уходит в `logError`.
   */
  onThreshold?: (event: SpendingThresholdEvent) => void | Promise<void>;
  /**
   * Счёт окна сообщений дошёл до порога (те же `thresholds`): «осталось N сообщений». Одно событие на порог в каждом
   * окне; проверка — когда сообщение берёт место. Сообщение потом не записалось — событие уже ушло, второго на тот же
   * порог не будет. Ход обработчик не ждёт, ошибка уходит в `logError`. Нет — событий о сообщениях нет.
   */
  onMessageThreshold?: (event: MessageThresholdEvent) => void | Promise<void>;
  /** Правила хода: запас на старт, перерасход, потолки денег и вызовов. */
  turn?: TurnRulesConfig;
  /**
   * Что делать, если у модели каталога нет цены у какого-то провайдера. `reject` (по умолчанию) — ошибка при создании
   * со списком пар; `ignore` — ходы такой модели записываются со стоимостью 0, а при создании в журнал сервера
   * один раз пишется предупреждение со списком пар.
   */
  unpricedModels?: "reject" | "ignore";
  /**
   * Кто живёт без лимитов (сотрудники, тестовые аккаунты): `true` — ни одно окно, ни денежное, ни сообщений, человека
   * не ограничивает. Зовётся на каждую проверку; ошибка функции отклоняет ход. Блокировку (`blocked`) не снимает.
   * Потолок одного хода (`turnRules`: `maxCostUsd`, `maxToolCalls`) тоже остаётся: это защита от бесконечного хода,
   * а не лимит человека.
   */
  exemptUsers?: (subject: { userId: string; chatId?: string }) => boolean | Promise<boolean>;
  /** Часы; по умолчанию настоящие. Нужны тестам. */
  now?: () => Date;
  /** Журнал сервера. По умолчанию `console.error`. */
  logError?: (message: string) => void;
}

export interface ScopeSpending {
  /** Бюджет в долларах; `null` — лимита нет. */
  limitUsd: number | null;
  spentUsd: number;
  /** Сколько осталось; при перерасходе 0. */
  remainingUsd: number | null;
  /** Доля израсходованного (может быть больше 1). */
  share: number | null;
  state: SpendingState;
  period: SpendingPeriod;
  periodStart: string | null;
  resetsAt: string | null;
}

/** Окно лимита для страницы приложения: доллары и границы. */
export interface WindowSpending {
  id: string;
  scope: SpendingScope;
  period: SpendingPeriod;
  hours?: number;
  limitUsd: number;
  /** Расход в окне вместе с перенесённым перерасходом. */
  spentUsd: number;
  remainingUsd: number;
  share: number;
  state: SpendingState;
  /** Начало окна; `null` — на всё время или скользящее ещё не началось. */
  start: string | null;
  resetsAt: string | null;
  /** Перерасход прошлого окна, перенесённый в это. */
  carriedUsd: number;
}

/** Окно сообщений для страницы приложения: лимит, отправлено, осталось. */
export interface MessageWindowSpending {
  id: string;
  scope: SpendingScope;
  period: SpendingPeriod;
  hours?: number;
  limit: number;
  used: number;
  remaining: number;
  share: number;
  state: SpendingState;
  /** Начало окна; `null` — на всё время или скользящее ещё не началось. */
  start: string | null;
  resetsAt: string | null;
}

export interface SpendingReport {
  user: ScopeSpending;
  /** Пояс лимитов, если задан: границы периода и дату обновления показывать по нему. */
  timeZone?: string;
  /** Есть, если спрошен чат. */
  chat?: ScopeSpending;
  /** Денежные окна с лимитом (лимиты с окнами). */
  windows?: WindowSpending[];
  /** Окна сообщений с лимитом; есть, только если такие окна заданы. */
  messageWindows?: MessageWindowSpending[];
  /** Человек заблокирован (лимиты с окнами). */
  blocked?: boolean;
}

export interface SpendingLimitsService extends SpendingLimits {
  /** Расход и лимиты для страницы приложения («тариф»): доллары и границы периода. */
  getSpending(input: { userId: string; chatId?: string }): Promise<SpendingReport>;
  /** Личные настройки человека: блокировка и свои лимиты окон. Нужны методы состояния хранилища. */
  getUserSettings(userId: string): Promise<UserSpendingSettings>;
  setUserSettings(userId: string, patch: UserSpendingSettingsPatch): Promise<UserSpendingSettings>;
  /**
   * Ручной сброс окна: расход до этого момента в окне не считается, перенос стирается. Окно человека — с `userId`,
   * чата — с `chatId`, сервиса — без них. Скользящее окно закрывается: новое начнётся с первого запроса.
   */
  resetWindow(input: { windowId: string; userId?: string; chatId?: string }): Promise<void>;
}

interface PersonState {
  blocked?: boolean;
  limits?: Record<string, number | null>;
}

export function createSpendingLimits(options: SpendingLimitsOptions): SpendingLimitsService {
  const { storage } = options;
  const now = options.now ?? (() => new Date());
  const logError = options.logError ?? ((message: string) => console.error(message));
  const warnAt = options.warnAt ?? DEFAULT_WARN_AT;
  if (!(Number.isFinite(warnAt) && warnAt > 0 && warnAt < 1)) {
    throw new Error(`warnAt должен быть числом больше 0 и меньше 1, получено ${String(warnAt)}`);
  }
  const timeZone = checkedTimeZone(options.timeZone);
  const zone = timeZone === undefined ? {} : { timeZone };
  const thresholds = checkedThresholds(options.thresholds);
  const turn = checkedTurnRules(options.turn);
  const store = limitStateStore(storage);
  // Прежний способ (`budget`) отдаёт прежний вид отказа, состояния и отчёта: без окон.
  const legacy = options.windows === undefined;
  if (!legacy && options.budget) throw new Error("Лимиты задаются одним способом: windows или budget с period, не обоими");
  if (legacy && !options.budget) throw new Error("Нужны окна лимитов (windows) или бюджет (budget)");
  const allWindows = legacy ? legacyWindows(options.period, timeZone) : normalizeWindows(options.windows!, timeZone);
  // Деньги и сообщения считаются порознь: проверка хода, запас и пороги смотрят только на деньги.
  const windows = allWindows.filter((window) => window.measure === "usd");
  const messageWindows = allWindows.filter((window) => window.measure === "messages");
  const needsState = allWindows.find((window) => window.kind === "rolling" || window.measure === "messages");
  if (!store && needsState) {
    const why = needsState.measure === "messages" ? "считает сообщения" : "скользящее";
    throw new Error(`Окно «${needsState.id}» ${why}: хранилищу нужны методы getSpendingLimitState и saveSpendingLimitState`);
  }
  if (!store && options.onThreshold) throw new Error("onThreshold: хранилищу нужны методы getSpendingLimitState и saveSpendingLimitState");
  const unpriced = findUnpricedModels(options.catalog);
  if (unpriced.length > 0) {
    if ((options.unpricedModels ?? "reject") === "reject") {
      throw new Error(
        `Нет цены у моделей: ${unpriced.join(", ")}. Задайте pricing в профиле или подключите лимиты с unpricedModels: "ignore" (расход таких моделей не считается).`,
      );
    }
    logError(`Нет цены у моделей: ${unpriced.join(", ")}. Их ходы записываются со стоимостью 0 и в лимиты не входят`);
  }

  function requireStore() {
    if (!store) throw new Error("Личные настройки и сброс окон: хранилищу нужны методы getSpendingLimitState и saveSpendingLimitState");
    return store;
  }

  async function budgetFor(subject: SpendingSubject): Promise<SpendingBudget> {
    try {
      const budget = await options.budget!({ userId: subject.userId, ...(subject.chatId !== undefined && { chatId: subject.chatId }) });
      for (const scope of ["user", "chat"] as const) {
        const amount = budget[scope];
        if (amount !== undefined && !(typeof amount === "number" && Number.isFinite(amount) && amount >= 0)) {
          throw new Error(`Бюджет «${scope}» должен быть неотрицательным числом, получено ${String(amount)}`);
        }
      }
      return budget;
    } catch (failure) {
      logError(`Не удалось получить бюджет расходов человека ${subject.userId}: ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`);
      throw failure;
    }
  }

  async function personOf(userId: string): Promise<PersonState> {
    return (store && (await store.read<PersonState>(`person:${userId}`))) ?? {};
  }

  async function isExempt(subject: SpendingSubject): Promise<boolean> {
    if (!options.exemptUsers) return false;
    try {
      return (await options.exemptUsers({ userId: subject.userId, ...(subject.chatId !== undefined && { chatId: subject.chatId }) })) === true;
    } catch (failure) {
      logError(`exemptUsers упал (человек ${subject.userId}): ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`);
      throw failure;
    }
  }

  /**
   * Лимит каждого окна (и денег, и сообщений) для человека и чата: свой лимит человека, иначе общий. `undefined` —
   * у окна нет лимита; у человека без лимитов (`exemptUsers`) — ни у одного окна.
   */
  async function limitsFor(subject: SpendingSubject, person: PersonState): Promise<Map<string, number | undefined>> {
    if (await isExempt(subject)) return new Map();
    if (legacy) {
      const budget = await budgetFor(subject);
      return new Map([["user", budget.user], ["chat", budget.chat]]);
    }
    const entries = await Promise.all(
      allWindows.map(async (window): Promise<[string, number | undefined]> => {
        const own = window.scope === "service" ? undefined : person.limits?.[window.id];
        if (own !== undefined) return [window.id, own === null ? undefined : own];
        return [window.id, await window.limit(subject)];
      }),
    );
    return new Map(entries);
  }

  async function sumSince(filter: UsageFilter, since: string | null): Promise<number> {
    const sums = await storage.sumUsage({ ...filter, ...(since !== null && { since }) });
    return sums.reduce((total, sum) => total + sum.costUsd, 0);
  }

  /** Окна с лимитом (и, для отчёта, без него) у человека и чата. */
  async function readAll(
    subject: SpendingSubject,
    person: PersonState,
    read: { open: boolean; withoutLimit?: (window: SpendingWindow) => boolean; pending?: { user: number; chat: number }; limits?: Map<string, number | undefined> },
  ): Promise<WindowReading[]> {
    const limits = read.limits ?? (await limitsFor(subject, person));
    const moment = now();
    const readings = await Promise.all(
      windows.map((window) => {
        const limitUsd = limits.get(window.id);
        if (limitUsd === undefined && !read.withoutLimit?.(window)) return null;
        const pendingUsd = read.pending && (window.scope === "chat" ? read.pending.chat : read.pending.user);
        return readWindow({ window, subject, limitUsd, now: moment, store, sumSince, warnAt, open: read.open, ...(pendingUsd !== undefined && { pendingUsd }) });
      }),
    );
    return readings.filter((reading): reading is WindowReading => reading !== null);
  }

  /** Переход окон в новое и открытие скользящих: запись ложится, только если окно никто не сменил раньше. */
  async function saveTransitions(readings: readonly WindowReading[]): Promise<void> {
    if (!store) return;
    await Promise.all(
      readings
        .filter((reading) => reading.nextState !== null)
        .map((reading) =>
          store.update<WindowState>(reading.stateKey, (current) => {
            const currentStart = current === null ? undefined : current.start;
            return currentStart === reading.savedStart ? reading.nextState : null;
          }),
        ),
    );
  }

  function refusal(reading: WindowReading, reason: SpendingRefusalReason): SpendingLimitReachedError {
    const { window } = reading;
    return new SpendingLimitReachedError({
      scope: window.scope,
      period: window.period,
      resetsAt: reading.resetsAt,
      ...zone,
      ...(!legacy && { reason, windowId: window.id, ...(window.hours !== undefined && { hours: window.hours }) }),
    });
  }

  async function notifyThresholds(reading: WindowReading, subject: SpendingSubject): Promise<void> {
    if (!store || !options.onThreshold || reading.waiting || reading.limitUsd === null || reading.share === null) return;
    const share = reading.share;
    let crossed: number[] = [];
    await store.update<WindowState>(reading.stateKey, (current) => {
      const base = current !== null && current.start === reading.start ? current : { start: reading.start, carriedUsd: reading.carriedUsd, notified: [] };
      crossed = thresholds.filter((threshold) => share >= threshold && !base.notified.includes(threshold));
      return crossed.length === 0 ? null : { ...base, notified: [...base.notified, ...crossed] };
    });
    const { window } = reading;
    for (const threshold of crossed) {
      const event: SpendingThresholdEvent = {
        windowId: window.id,
        scope: window.scope,
        period: window.period,
        ...(window.hours !== undefined && { hours: window.hours }),
        threshold,
        share,
        spentUsd: reading.spentUsd,
        limitUsd: reading.limitUsd,
        windowStart: reading.start,
        resetsAt: reading.resetsAt,
        userId: subject.userId,
        ...(subject.chatId !== undefined && { chatId: subject.chatId }),
      };
      const report = (failure: unknown) =>
        logError(`onThreshold упал (окно ${window.id}, порог ${threshold}): ${failure instanceof Error ? failure.message : String(failure)}`);
      try {
        void Promise.resolve(options.onThreshold(event)).catch(report);
      } catch (failure) {
        report(failure);
      }
    }
  }

  function notifyMessageThreshold(crossing: MessageThresholdCrossing, subject: SpendingSubject): void {
    const { window, threshold, used, limit } = crossing;
    const event: MessageThresholdEvent = {
      windowId: window.id,
      scope: window.scope,
      period: window.period,
      ...(window.hours !== undefined && { hours: window.hours }),
      threshold,
      share: limit === 0 ? 1 : used / limit,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      windowStart: crossing.start,
      resetsAt: crossing.resetsAt,
      userId: subject.userId,
      ...(subject.chatId !== undefined && { chatId: subject.chatId }),
    };
    const report = (failure: unknown) =>
      logError(`onMessageThreshold упал (окно ${window.id}, порог ${threshold}): ${failure instanceof Error ? failure.message : String(failure)}`);
    try {
      void Promise.resolve(options.onMessageThreshold!(event)).catch(report);
    } catch (failure) {
      report(failure);
    }
  }

  /** Окно, где остаток меньше запаса на старт (самый малый остаток); исчерпанные окна — не про запас. */
  function shortOfReserve(readings: readonly WindowReading[]): WindowReading | null {
    const reserve = turn?.minRemainingUsd;
    if (reserve === undefined || readings.some((reading) => reading.state === "exhausted")) return null;
    const short = readings.filter((reading) => remainingOf(reading) < reserve - 1e-9);
    if (short.length === 0) return null;
    return short.reduce((least, reading) => (remainingOf(reading) < remainingOf(least) ? reading : least));
  }

  /** Окна сообщений с лимитом у человека и чата. */
  async function readMessages(subject: SpendingSubject, limits: Map<string, number | undefined>): Promise<MessageWindowReading[]> {
    if (messageWindows.length === 0) return [];
    const moment = now();
    const readings = await Promise.all(
      messageWindows.map((window) => {
        const limit = limits.get(window.id);
        return limit === undefined ? null : readMessageWindow({ window, subject, limit, now: moment, store: store!, warnAt });
      }),
    );
    return readings.filter((reading): reading is MessageWindowReading => reading !== null);
  }

  function findWindow(windowId: string): SpendingWindow {
    const window = allWindows.find((candidate) => candidate.id === windowId);
    if (!window) throw new Error(`Нет окна лимита «${windowId}»`);
    return window;
  }

  return {
    ...zone,

    async assertWithinLimit({ userId, chatId, pendingUsd }) {
      const subject = { userId, chatId };
      const person = await personOf(userId);
      if (person.blocked) {
        throw new SpendingLimitReachedError({ scope: "user", period: "none", resetsAt: null, ...zone, reason: "blocked" });
      }
      // Проверка перед ходом открывает скользящие окна; проверка посреди хода (картинки) — нет: окно уже идёт.
      const readings = await readAll(subject, person, { open: pendingUsd === undefined, ...(pendingUsd && { pending: pendingUsd }) });
      const exhausted = readings.filter((reading) => reading.state === "exhausted");
      const short = pendingUsd === undefined && exhausted.length === 0 ? shortOfReserve(readings) : null;
      if (exhausted.length > 0 || short) {
        // Окно, которое началось с долгом, записывается и при отказе: иначе долг считался бы заново из прошлого окна,
        // скользящее окно не открывалось бы никогда, а сброс уезжал бы вперёд.
        await saveTransitions(readings.filter((reading) => (reading.nextState?.carriedUsd ?? 0) > 0));
      }
      if (exhausted.length > 0) {
        // Открыть чат можно, только когда сняты все лимиты: называем тот, что снимется позже.
        throw refusal(exhausted.reduce((latest, reading) => (resetsLater(reading, latest) ? reading : latest)), "limit");
      }
      if (short) throw refusal(short, "reserve");
      await saveTransitions(readings);
    },

    async status({ userId, chatId }): Promise<SpendingStatus> {
      const subject = { userId, chatId };
      const person = await personOf(userId);
      const limits = await limitsFor(subject, person);
      const [readings, messageReadings] = await Promise.all([readAll(subject, person, { open: false, limits }), readMessages(subject, limits)]);
      // Пометка денежных окон появляется только рядом с окнами сообщений: прежние настройки — прежний ответ.
      const marked = messageWindows.length > 0;
      const windowStatuses = legacy ? undefined : [...readings.map((reading) => toWindowStatus(reading, marked)), ...messageReadings.map(toMessageWindowStatus)];
      const listed = windowStatuses ? { windows: windowStatuses } : {};
      if (person.blocked) return { state: "exhausted", reason: "blocked", blocked: true, ...zone, ...listed };
      const judged: Array<WindowReading | MessageWindowReading> = [...readings, ...messageReadings];
      if (judged.length === 0) return { state: "ok", ...listed };
      const short = shortOfReserve(readings);
      const worst = short ?? judged.reduce((current, reading) => (isWorse(reading, current) ? reading : current));
      const state = short ? "exhausted" : worst.state;
      const { window } = worst;
      return {
        state,
        ...(!legacy && state === "exhausted" && { reason: short ? ("reserve" as const) : ("limit" as const) }),
        scope: window.scope,
        period: window.period,
        share: worst.share!,
        resetsAt: worst.resetsAt,
        ...zone,
        ...(!legacy && { windowId: window.id, ...(window.hours !== undefined && { hours: window.hours }) }),
        ...("used" in worst && { unit: "messages" as const, remaining: Math.max(0, worst.limit - worst.used) }),
        ...listed,
      };
    },

    async chatDeleted({ userId, chatId }) {
      const keys = allWindows.filter((window) => window.scope === "chat").map((window) => windowStateKey(window, { userId, chatId })!);
      await storage.deleteSpendingLimitStates?.(keys);
    },

    async takeMessage({ userId, chatId }) {
      if (messageWindows.length === 0) return undefined;
      const subject = { userId, chatId };
      const limits = await limitsFor(subject, await personOf(userId));
      const limited = messageWindows.flatMap((window) => {
        const limit = limits.get(window.id);
        return limit === undefined ? [] : [{ window, limit }];
      });
      if (limited.length === 0) return undefined;
      const { taken, refused, crossed } = await takeMessageSlots({
        windows: limited,
        subject,
        now: now(),
        store: store!,
        thresholds: options.onMessageThreshold ? thresholds : [],
      });
      if (refused.length > 0) {
        // Как у денег: называем окно, которое освободится позже.
        const latest = refused.reduce((current, candidate) => (resetsLater(candidate, current) ? candidate : current));
        const { window } = latest;
        throw new SpendingLimitReachedError({
          scope: window.scope,
          period: window.period,
          resetsAt: latest.resetsAt,
          ...zone,
          reason: "limit",
          windowId: window.id,
          ...(window.hours !== undefined && { hours: window.hours }),
          unit: "messages",
        });
      }
      for (const crossing of crossed) notifyMessageThreshold(crossing, subject);
      return taken.length > 0 ? () => giveBackMessageSlots(store!, taken) : undefined;
    },

    async turnRules({ userId, chatId }): Promise<TurnSpendingRules | undefined> {
      if (!turn) return undefined;
      let maxCostUsd = turn.maxCostUsd;
      if (turn.overrun === "stop") {
        const readings = await readAll({ userId, chatId }, await personOf(userId), { open: false });
        for (const reading of readings) {
          if (reading.limitUsd === null) continue;
          maxCostUsd = Math.min(maxCostUsd ?? Infinity, remainingOf(reading));
        }
      }
      const rules: TurnSpendingRules = {
        ...(maxCostUsd !== undefined && Number.isFinite(maxCostUsd) && { maxCostUsd }),
        ...(turn.maxToolCalls !== undefined && { maxToolCalls: turn.maxToolCalls }),
      };
      return Object.keys(rules).length > 0 ? rules : undefined;
    },

    async afterSpending({ userId, chatId }) {
      const subject = { userId, chatId };
      const readings = await readAll(subject, await personOf(userId), { open: false });
      await saveTransitions(readings);
      await Promise.all(readings.map((reading) => notifyThresholds(reading, subject)));
    },

    async getSpending({ userId, chatId }) {
      const subject = { userId, ...(chatId !== undefined && { chatId }) };
      const person = await personOf(userId);
      const limits = await limitsFor(subject, person);
      // Прежний вид: человек читается всегда, чат — если спрошен, даже без бюджета.
      const readings = await readAll(subject, person, { open: false, limits, withoutLimit: (window) => legacy && (window.scope === "user" || chatId !== undefined) });
      const firstOf = (scope: SpendingScope) => readings.find((reading) => reading.window.scope === scope);
      const user = firstOf("user");
      const chat = chatId === undefined ? undefined : firstOf("chat");
      const report: SpendingReport = {
        user: user ? toScopeSpending(user) : await unlimitedUser(userId),
        ...(chat && { chat: toScopeSpending(chat) }),
        ...zone,
      };
      if (legacy) return report;
      const messages = messageWindows.length > 0 && { messageWindows: (await readMessages(subject, limits)).map(toMessageWindowSpending) };
      return { ...report, windows: readings.filter((reading) => reading.limitUsd !== null).map(toWindowSpending), ...messages, blocked: person.blocked === true };
    },

    async getUserSettings(userId) {
      const person = store ? await personOf(userId) : {};
      return { blocked: person.blocked === true, limits: { ...person.limits } };
    },

    async setUserSettings(userId, patch) {
      const state = requireStore();
      if (legacy && patch.limits && Object.keys(patch.limits).length > 0) {
        throw new Error("Свои лимиты человека задаются только для окон (windows); с budget лимит человека — в самой функции budget");
      }
      for (const [windowId, amount] of Object.entries(patch.limits ?? {})) {
        const window = findWindow(windowId);
        if (window.scope === "service") throw new Error(`Окно «${windowId}» — общее для сервиса: своего лимита у человека в нём нет`);
        if (amount !== null && amount !== "default") validLimit(amount, window.measure, `Свой лимит окна «${windowId}» (число, null или "default")`);
      }
      const { value } = await state.update<PersonState>(`person:${userId}`, (current) => {
        const limits = { ...current?.limits };
        for (const [windowId, amount] of Object.entries(patch.limits ?? {})) {
          if (amount === "default") delete limits[windowId];
          else limits[windowId] = amount;
        }
        return { blocked: patch.blocked ?? current?.blocked ?? false, limits };
      });
      return { blocked: value?.blocked === true, limits: { ...value?.limits } };
    },

    async resetWindow({ windowId, userId, chatId }) {
      const state = requireStore();
      const window = findWindow(windowId);
      if (window.scope === "user" && userId === undefined) throw new Error(`Окно «${windowId}» — окно человека: нужен userId`);
      if (window.scope === "chat" && chatId === undefined) throw new Error(`Окно «${windowId}» — окно чата: нужен chatId`);
      const subject = { userId: userId ?? "", ...(chatId !== undefined && { chatId }) };
      const key = windowStateKey(window, subject)!;
      const resetAt = now().toISOString();
      await state.update<WindowState>(key, () => {
        // Пороги после сброса шлются снова. Скользящее окно закрывается; календарное и на всё время — считаются с момента сброса.
        if (window.kind === "rolling") return { start: null, carriedUsd: 0, notified: [] };
        const reading = currentStart(window, now());
        return { start: reading, carriedUsd: 0, resetAt, notified: [] };
      });
    },
  };

  async function unlimitedUser(userId: string): Promise<ScopeSpending> {
    const spentUsd = await sumSince({ ownerId: userId }, null);
    return { limitUsd: null, spentUsd, remainingUsd: null, share: null, state: "ok", period: "none", periodStart: null, resetsAt: null };
  }
}

function currentStart(window: SpendingWindow, moment: Date): string | null {
  if (window.kind !== "calendar") return null;
  return readWindowStart(window, moment);
}

function readWindowStart(window: SpendingWindow, moment: Date): string {
  return calendarBounds(window.unit!, moment, window.timeZone, window.weekStartsOn).start;
}

/** Прежние области «человек» и «чат» как окна с именами `user` и `chat`. */
function legacyWindows(period: SpendingLimitsOptions["period"], timeZone: string | undefined): SpendingWindow[] {
  const periods = typeof period === "object" ? { user: period.user ?? DEFAULT_PERIOD, chat: period.chat ?? DEFAULT_PERIOD } : { user: period ?? DEFAULT_PERIOD, chat: period ?? DEFAULT_PERIOD };
  return (["user", "chat"] as const).map((scope) => {
    const scopePeriod = periods[scope];
    const base = { id: scope, scope, carryOverrun: false, measure: "usd" as const, weekStartsOn: 1, timeZone: timeZone ?? "UTC", limit: async () => undefined };
    if (scopePeriod === "none") return { ...base, kind: "total", period: "none" };
    if (scopePeriod !== "day" && scopePeriod !== "month" && scopePeriod !== "week") {
      throw new Error(`period: ${String(scopePeriod)} — для budget только month, week, day или none; скользящие окна — через windows`);
    }
    return { ...base, kind: "calendar", unit: scopePeriod, period: scopePeriod };
  });
}

function checkedTimeZone(timeZone: string | undefined): string | undefined {
  if (timeZone === undefined) return undefined;
  if (resolveTimeZone(timeZone) === undefined) {
    throw new Error(`timeZone: «${String(timeZone)}» — не часовой пояс IANA; нужен, например, «Europe/Moscow»`);
  }
  return timeZone;
}

function checkedThresholds(thresholds: readonly number[] | undefined): number[] {
  const list = [...(thresholds ?? DEFAULT_THRESHOLDS)];
  for (const threshold of list) {
    if (!(Number.isFinite(threshold) && threshold > 0 && threshold <= 1)) {
      throw new Error(`thresholds: доли лимита больше 0 и не больше 1, получено ${String(threshold)}`);
    }
  }
  return [...new Set(list)].sort((a, b) => a - b);
}

function checkedTurnRules(turn: TurnRulesConfig | undefined): TurnRulesConfig | undefined {
  if (!turn) return undefined;
  for (const field of ["minRemainingUsd", "maxCostUsd"] as const) {
    const amount = turn[field];
    if (amount !== undefined && !(Number.isFinite(amount) && amount >= 0)) throw new Error(`turn.${field}: неотрицательное число долларов, получено ${String(amount)}`);
  }
  if (turn.maxToolCalls !== undefined && !(Number.isInteger(turn.maxToolCalls) && turn.maxToolCalls >= 0)) {
    throw new Error(`turn.maxToolCalls: целое число от 0, получено ${String(turn.maxToolCalls)}`);
  }
  if (turn.overrun !== undefined && turn.overrun !== "finish" && turn.overrun !== "stop") {
    throw new Error(`turn.overrun: finish или stop, получено ${String(turn.overrun)}`);
  }
  return turn;
}

/** Пары «модель × провайдер» каталога, у которых нет цены. */
function findUnpricedModels(catalog: ModelCatalog): string[] {
  const missing: string[] = [];
  for (const model of catalog.models) {
    for (const providerId of Object.keys(model.providerModelIds)) {
      if (!model.pricing?.[providerId]) missing.push(`${model.id} × ${providerId}`);
    }
  }
  return missing;
}

function remainingOf(reading: WindowReading): number {
  return reading.limitUsd === null ? Infinity : reading.limitUsd - reading.spentUsd;
}

/** Обновление позже: без обновления (никогда) — самое позднее. */
function resetsLater(candidate: { resetsAt: string | null }, current: { resetsAt: string | null }): boolean {
  if (candidate.resetsAt === null) return current.resetsAt !== null;
  if (current.resetsAt === null) return false;
  return candidate.resetsAt > current.resetsAt;
}

function isWorse(candidate: { state: SpendingState; share: number | null }, current: { state: SpendingState; share: number | null }): boolean {
  const bySeverity = STATE_SEVERITY[candidate.state] - STATE_SEVERITY[current.state];
  if (bySeverity !== 0) return bySeverity > 0;
  return (candidate.share ?? 0) > (current.share ?? 0);
}

function toWindowStatus(reading: WindowReading, marked: boolean): SpendingWindowStatus {
  const { window } = reading;
  return {
    id: window.id,
    scope: window.scope,
    period: window.period,
    ...(window.hours !== undefined && { hours: window.hours }),
    state: reading.state,
    share: reading.share ?? 0,
    resetsAt: reading.resetsAt,
    ...(marked && { unit: "usd" as const }),
  };
}

function toMessageWindowStatus(reading: MessageWindowReading): SpendingWindowStatus {
  const { window } = reading;
  return {
    id: window.id,
    scope: window.scope,
    period: window.period,
    ...(window.hours !== undefined && { hours: window.hours }),
    state: reading.state,
    share: reading.share,
    resetsAt: reading.resetsAt,
    unit: "messages",
    limit: reading.limit,
    used: reading.used,
    remaining: Math.max(0, reading.limit - reading.used),
  };
}

function toMessageWindowSpending(reading: MessageWindowReading): MessageWindowSpending {
  const { window } = reading;
  return {
    id: window.id,
    scope: window.scope,
    period: window.period,
    ...(window.hours !== undefined && { hours: window.hours }),
    limit: reading.limit,
    used: reading.used,
    remaining: Math.max(0, reading.limit - reading.used),
    share: reading.share,
    state: reading.state,
    start: reading.start,
    resetsAt: reading.resetsAt,
  };
}

function toWindowSpending(reading: WindowReading): WindowSpending {
  const { window } = reading;
  return {
    id: window.id,
    scope: window.scope,
    period: window.period,
    ...(window.hours !== undefined && { hours: window.hours }),
    limitUsd: reading.limitUsd!,
    spentUsd: reading.spentUsd,
    remainingUsd: Math.max(0, reading.limitUsd! - reading.spentUsd),
    share: reading.share!,
    state: reading.state,
    start: reading.start,
    resetsAt: reading.resetsAt,
    carriedUsd: reading.carriedUsd,
  };
}

function toScopeSpending(reading: WindowReading): ScopeSpending {
  return {
    limitUsd: reading.limitUsd,
    spentUsd: reading.spentUsd,
    remainingUsd: reading.limitUsd === null ? null : Math.max(0, reading.limitUsd - reading.spentUsd),
    share: reading.share,
    state: reading.state,
    period: reading.window.period,
    periodStart: reading.start,
    resetsAt: reading.resetsAt,
  };
}
