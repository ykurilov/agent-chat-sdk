import { resolveTimeZone } from "@ykurilov/agent-chat-core";
import type { SpendingPeriod, SpendingScope } from "@ykurilov/agent-chat-core";
import type { CalendarUnit } from "./spending-period";

/** Чей лимит считается: человек и чат хода. `chatId` нет — окна чата не читаются. */
export interface SpendingSubject {
  userId: string;
  chatId?: string;
}

/**
 * Лимит окна в долларах или сообщениях: число или функция от человека и чата (у тарифов разные лимиты). Функция
 * зовётся на каждую проверку, так что смена тарифа действует сразу; `undefined` или `null` — у этого человека окна нет.
 */
export type WindowLimit = number | ((subject: SpendingSubject) => number | null | undefined | Promise<number | null | undefined>);

interface WindowBase {
  /** Имя окна: по нему личные лимиты, ручной сброс, события порогов и экран. Уникальное. */
  id: string;
  /** Чей расход: человека (все его чаты), одного чата или всего сервиса (все люди вместе). */
  scope: SpendingScope;
  /** Лимит в долларах. У окна ровно один лимит: `limitUsd` или `limitMessages`. */
  limitUsd?: WindowLimit;
  /**
   * Лимит в сообщениях человека (целое число): считаются отправка и правка, переделка, повтор, служебные и ответы на
   * подтверждения — нет. Счёт ведётся в состоянии лимитов, удаление чата его не сбрасывает; нужны методы состояния
   * хранилища. Ход такого окна не останавливает: место берётся одно на сообщение до его записи.
   */
  limitMessages?: WindowLimit;
  /** Перерасход окна (ход доделан сверх лимита) переносится в начало следующего окна. По умолчанию нет. Только у денег. */
  carryOverrun?: boolean;
}

/** Календарное окно: сутки, неделя или месяц по часовому поясу. */
export interface CalendarWindowConfig extends WindowBase {
  kind: "calendar";
  unit: CalendarUnit;
  /** Пояс IANA; нет — пояс лимитов (`timeZone`), без него — UTC. */
  timeZone?: string;
  /** С какого дня начинается неделя: 1 — понедельник (по умолчанию) … 7 — воскресенье. */
  weekStartsOn?: number;
}

/** Скользящее окно: `hours` часов от первого запроса после конца прошлого окна. Нужны методы состояния хранилища. */
export interface RollingWindowConfig extends WindowBase {
  kind: "rolling";
  hours: number;
}

/** Окно на всё время: расход не обнуляется (сбросить можно вручную). */
export interface TotalWindowConfig extends WindowBase {
  kind: "total";
}

export type SpendingWindowConfig = CalendarWindowConfig | RollingWindowConfig | TotalWindowConfig;

/** Окно после проверки настроек: пояс и день недели подставлены, лимит — всегда функция. */
export interface SpendingWindow {
  id: string;
  scope: SpendingScope;
  kind: "calendar" | "rolling" | "total";
  unit?: CalendarUnit;
  timeZone: string;
  weekStartsOn: number;
  hours?: number;
  carryOverrun: boolean;
  period: SpendingPeriod;
  /** Чем меряется окно: доллары или сообщения человека. */
  measure: WindowMeasure;
  limit: (subject: SpendingSubject) => Promise<number | undefined>;
}

export type WindowMeasure = "usd" | "messages";

const SCOPES: readonly SpendingScope[] = ["user", "chat", "service"];
const UNITS: readonly CalendarUnit[] = ["day", "week", "month"];

/** Проверяет настройки окон и приводит их к одному виду. Ошибка — при создании лимитов, а не на первом ходе. */
export function normalizeWindows(configs: readonly SpendingWindowConfig[], defaultTimeZone: string | undefined): SpendingWindow[] {
  const seen = new Set<string>();
  return configs.map((config) => {
    const where = `Окно лимита «${String(config.id)}»`;
    if (typeof config.id !== "string" || config.id === "") throw new Error("Окно лимита: нужно непустое имя id");
    if (seen.has(config.id)) throw new Error(`${where}: имя повторяется`);
    seen.add(config.id);
    if (!SCOPES.includes(config.scope)) throw new Error(`${where}: scope — user, chat или service, получено ${String(config.scope)}`);
    const hasUsd = config.limitUsd !== undefined;
    if (hasUsd === (config.limitMessages !== undefined)) throw new Error(`${where}: нужен ровно один лимит — limitUsd или limitMessages`);
    const measure: WindowMeasure = hasUsd ? "usd" : "messages";
    if (measure === "messages" && config.carryOverrun === true) throw new Error(`${where}: carryOverrun бывает только у окна денег (limitUsd)`);
    const limit = checkedLimit(hasUsd ? config.limitUsd! : config.limitMessages!, measure, where);
    const base = { id: config.id, scope: config.scope, carryOverrun: config.carryOverrun === true, measure, limit, weekStartsOn: 1 };
    if (config.kind === "rolling") {
      if (!(Number.isFinite(config.hours) && config.hours > 0)) throw new Error(`${where}: hours — число часов больше 0, получено ${String(config.hours)}`);
      return { ...base, kind: "rolling", hours: config.hours, timeZone: "UTC", period: "rolling" };
    }
    if (config.kind === "total") return { ...base, kind: "total", timeZone: "UTC", period: "none" };
    if (config.kind !== "calendar") throw new Error(`${where}: kind — calendar, rolling или total, получено ${String((config as { kind: unknown }).kind)}`);
    if (!UNITS.includes(config.unit)) throw new Error(`${where}: unit — day, week или month, получено ${String(config.unit)}`);
    const weekStartsOn = config.weekStartsOn ?? 1;
    if (!(Number.isInteger(weekStartsOn) && weekStartsOn >= 1 && weekStartsOn <= 7)) {
      throw new Error(`${where}: weekStartsOn — от 1 (понедельник) до 7 (воскресенье), получено ${String(weekStartsOn)}`);
    }
    const timeZone = config.timeZone ?? defaultTimeZone ?? "UTC";
    if (resolveTimeZone(timeZone) === undefined) throw new Error(`${where}: «${timeZone}» — не часовой пояс IANA`);
    return { ...base, kind: "calendar", unit: config.unit, timeZone, weekStartsOn, period: config.unit };
  });
}

function checkedLimit(limit: WindowLimit, measure: WindowMeasure, where: string): SpendingWindow["limit"] {
  if (typeof limit === "function") {
    return async (subject) => {
      const amount = await limit(subject);
      if (amount === undefined || amount === null) return undefined;
      return validLimit(amount, measure, where);
    };
  }
  const amount = validLimit(limit, measure, where);
  return async () => amount;
}

/** Лимит окна: доллары — неотрицательное число, сообщения — целое неотрицательное. */
export function validLimit(amount: unknown, measure: WindowMeasure, where: string): number {
  if (measure === "messages") {
    if (typeof amount === "number" && Number.isInteger(amount) && amount >= 0) return amount;
    throw new Error(`${where}: limitMessages — целое неотрицательное число сообщений, получено ${String(amount)}`);
  }
  if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) return amount;
  throw new Error(`${where}: limitUsd — неотрицательное число долларов, получено ${String(amount)}`);
}
