import type { SpendingPeriod } from "@ykurilov/agent-chat-core";

export interface PeriodBounds {
  /** Начало периода (ISO, UTC); `null` — период без начала. */
  start: string | null;
  /** Когда расход обнулится (ISO, UTC); `null` — никогда. */
  resetsAt: string | null;
}

/**
 * Период, в который попадает момент `now`: месяц с 1-го числа, сутки с полуночи. Полночь — по часовому поясу
 * `timeZone` (IANA, уже проверенный), без него — по UTC. Сутки при переходе на летнее время длятся 23 или 25 часов.
 */
export function periodBounds(period: SpendingPeriod, now: Date, timeZone = "UTC"): PeriodBounds {
  if (period === "none" || period === "rolling") return { start: null, resetsAt: null };
  const { start, end } = calendarBounds(period, now, timeZone);
  return { start, resetsAt: end };
}

export type CalendarUnit = "day" | "week" | "month";

/**
 * Календарное окно, в которое попадает момент: сутки с полуночи, неделя с полуночи дня `weekStartsOn`
 * (1 — понедельник … 7 — воскресенье), месяц с 1-го числа. Полночь — по поясу `timeZone` (IANA, уже проверенный).
 */
export function calendarBounds(unit: CalendarUnit, now: Date, timeZone = "UTC", weekStartsOn = 1): { start: string; end: string } {
  const { year, month, day } = localDate(now, timeZone);
  if (unit === "month") return { start: localMidnight(year, month, 1, timeZone), end: localMidnight(year, month + 1, 1, timeZone) };
  if (unit === "day") return { start: localMidnight(year, month, day, timeZone), end: localMidnight(year, month, day + 1, timeZone) };
  // День недели этой даты: 1 — понедельник … 7 — воскресенье.
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay() || 7;
  const startDay = day - ((weekday - weekStartsOn + 7) % 7);
  return { start: localMidnight(year, month, startDay, timeZone), end: localMidnight(year, month, startDay + 7, timeZone) };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Часы и календарь пояса: один форматтер на пояс, создавать его дорого. */
function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Дата и время на часах пояса в момент `moment`; месяц с нуля, как у `Date`. */
function wallClock(moment: Date, timeZone: string) {
  const parts = Object.fromEntries(formatterOf(timeZone).formatToParts(moment).map((part) => [part.type, Number(part.value)]));
  return { year: parts.year!, month: parts.month! - 1, day: parts.day!, hour: parts.hour!, minute: parts.minute!, second: parts.second! };
}

function localDate(moment: Date, timeZone: string) {
  const { year, month, day } = wallClock(moment, timeZone);
  return { year, month, day };
}

/** На сколько часы пояса впереди UTC в момент `epochMs`, мс. */
function offsetMs(epochMs: number, timeZone: string): number {
  const wall = wallClock(new Date(epochMs), timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - Math.floor(epochMs / 1000) * 1000;
}

const DAY_MS = 86_400_000;

/**
 * Момент, когда на часах пояса начинается эта дата (переполнение дня и месяца — как у `Date.UTC`). Смещение пояса
 * спрашиваем у Intl за сутки до и через сутки после: в день перехода на летнее время оно меняется, и полночь
 * считается по тому смещению, что действует в неё. Полночи нет (часы перевели с 00:00 на 01:00) — первый момент суток.
 */
function localMidnight(year: number, month: number, day: number, timeZone: string): string {
  const wallMidnight = Date.UTC(year, month, day);
  const target = new Date(wallMidnight);
  const candidates = [offsetMs(wallMidnight - DAY_MS, timeZone), offsetMs(wallMidnight + DAY_MS, timeZone)]
    .map((offset) => wallMidnight - offset)
    .filter((moment) => {
      const wall = wallClock(new Date(moment), timeZone);
      return wall.year === target.getUTCFullYear() && wall.month === target.getUTCMonth() && wall.day === target.getUTCDate();
    });
  return new Date(candidates.length > 0 ? Math.min(...candidates) : wallMidnight - offsetMs(wallMidnight, timeZone)).toISOString();
}
