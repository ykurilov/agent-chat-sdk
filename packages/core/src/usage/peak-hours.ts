import { resolveTimeZone } from "../agent-run/today";
import type { ModelPeakHours, ModelPeakWindow } from "../models/model-catalog";

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const MINUTES_PER_DAY = 24 * 60;

/** Что не так с расписанием часов пик; всё верно — `null`. Зовётся при создании каталога. */
export function peakHoursProblem(peak: ModelPeakHours): string | null {
  const multipliers = [peak.multiplier, peak.cachedInputMultiplier].filter((value) => value !== undefined);
  if (multipliers.some((value) => !(typeof value === "number" && Number.isFinite(value) && value >= 0))) {
    return "множитель должен быть неотрицательным числом";
  }
  if (peak.timeZone !== undefined && resolveTimeZone(peak.timeZone) === undefined) {
    return `«${String(peak.timeZone)}» — не часовой пояс IANA`;
  }
  if (!Array.isArray(peak.windows) || peak.windows.length === 0) return "нужно хотя бы одно окно";
  for (const window of peak.windows) {
    if (!Array.isArray(window.days) || window.days.length === 0 || window.days.some((day) => !(Number.isInteger(day) && day >= 1 && day <= 7))) {
      return "дни недели — числа от 1 (понедельник) до 7 (воскресенье)";
    }
    if (!CLOCK.test(String(window.from)) || !CLOCK.test(String(window.to))) return "час окна задаётся как «ЧЧ:ММ»";
    if (window.from === window.to) return `пустое окно ${window.from}–${window.to}`;
  }
  if ((peak.exceptDates ?? []).some((date) => !DATE.test(String(date)))) return "даты-исключения задаются как «ГГГГ-ММ-ДД»";
  return null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** День недели, дата и минута суток на часах пояса. */
function wallClock(moment: Date, timeZone: string) {
  const parts = Object.fromEntries(formatterOf(timeZone).formatToParts(moment).map((part) => [part.type, part.value]));
  return {
    weekday: WEEKDAYS[parts.weekday!]!,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/**
 * Попадает ли момент в часы пик. Окно через полночь (`22:00`–`02:00`) принадлежит дню, в который началось: хвост после
 * полуночи — пик и в следующий день. Дата-исключение снимает пик на свои сутки по поясу окон.
 */
export function isPeakTime(peak: ModelPeakHours, moment: Date): boolean {
  const clock = wallClock(moment, peak.timeZone ?? "UTC");
  if (peak.exceptDates?.includes(clock.date)) return false;
  const previousDay = clock.weekday === 1 ? 7 : clock.weekday - 1;
  return peak.windows.some((window) => inWindow(window, clock.weekday, previousDay, clock.minute));
}

function inWindow(window: ModelPeakWindow, weekday: number, previousDay: number, minute: number): boolean {
  const from = minuteOf(window.from);
  const to = minuteOf(window.to);
  if (from < to) return window.days.includes(weekday) && minute >= from && minute < to;
  // Через полночь: вечер своего дня или утро после дня окна.
  return (window.days.includes(weekday) && minute >= from && minute < MINUTES_PER_DAY) || (window.days.includes(previousDay) && minute < to);
}
