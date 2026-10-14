import { DEFAULT_LATE_START_HOURS, type FlowSchedule } from "../format/flow-format";
import { DEFAULT_FIRST_MESSAGES, type FlowRun } from "./flow-run";
import { clockMinutes, localDay, nextDate, parseClock, zonedParts, zonedTime, type ZonedDate } from "./zoned-time";

// Этап 4 сценариев: дни сценария по поясу человека. Чистые функции на `zoned-time.ts`, по plan.md, «Время и дни».
// День сценария длится от `dayStart` до `dayStart` следующих суток: ночь — ещё вчерашний день, нода «во сне» не проходит.

/** День сценария для хвоста шага, `readRun` и событий. Моменты — мс с 1970 года. */
export interface FlowDayInfo {
  /** Номер дня, с 1. 0 — вечер позднего старта до первого дня (→ В1). */
  day: number;
  /** Сколько дней в сценарии (`schedule.lengthDays`); нет срока — нет поля. */
  totalDays?: number;
  isLastDay: boolean;
  dayStartedAt: number;
  nextDayStartAt: number;
}

const DAY_MINUTES = 24 * 60;
const DAY_MS = 86_400_000;

const dayStartMinutes = (schedule: FlowSchedule) => parseClock(schedule.dayStart) ?? 0;
const nightMinutes = (schedule: FlowSchedule) => parseClock(schedule.nightFrom ?? DEFAULT_FIRST_MESSAGES.quietHours.from) ?? 0;

const dateKey = ({ year, month, day }: ZonedDate) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const dateOf = (key: string): ZonedDate => {
  const [year, month, day] = key.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
};
const shiftDate = (key: string, days: number) => dateKey(nextDate(dateOf(key), days));
/** Сколько суток от `from` до `to`, обе — «ГГГГ-ММ-ДД». */
const daysBetween = (from: string, to: string) => {
  const [a, b] = [dateOf(from), dateOf(to)];
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS);
};
const later = (a: string, b: string) => (a > b ? a : b);

/** Ночь начинается вечером (а не после полуночи) — тогда вечер после её начала относится к завтрашнему дню. */
const eveningNight = (schedule: FlowSchedule) => nightMinutes(schedule) > dayStartMinutes(schedule);

/** Местная дата дня сценария (`ГГГГ-ММ-ДД`): ночь и время до начала дня относятся к ближайшему утру. */
export function dayOf(at: number, timeZone: string, schedule: FlowSchedule): string {
  const today = localDay(at, timeZone);
  return eveningNight(schedule) && clockMinutes(at, timeZone) >= nightMinutes(schedule) ? shiftDate(today, 1) : today;
}

/** Какой день сценария идёт в момент `at`: последний наступивший `dayStart`. Ключ `dayCounts` и номера дня. */
export function dayInProgress(at: number, timeZone: string, schedule: FlowSchedule): string {
  const today = localDay(at, timeZone);
  return clockMinutes(at, timeZone) < dayStartMinutes(schedule) ? shiftDate(today, -1) : today;
}

/** Момент начала дня `localDate` в поясе (переход часов учтён). */
export function dayStartAt(localDate: string, timeZone: string, schedule: FlowSchedule): number {
  return zonedTime(dateOf(localDate), dayStartMinutes(schedule), timeZone);
}

/** Начало дня сценария, следующего за днём, к которому идёт момент `at` (ночь до начала дня — ещё прошлый день). */
export function nextDayStartAfter(at: number, timeZone: string, schedule: FlowSchedule): number {
  return dayStartAt(shiftDate(dayInProgress(at, timeZone, schedule), 1), timeZone, schedule);
}

/** Первый день сценария по моменту старта: день старта, а если до ночи осталось меньше порога — завтра (→ В1). */
function firstDayOf(startedAt: number, timeZone: string, schedule: FlowSchedule): string {
  const first = dayOf(startedAt, timeZone, schedule);
  const threshold = (schedule.lateStartHours ?? DEFAULT_LATE_START_HOURS) * 60;
  const clock = clockMinutes(startedAt, timeZone);
  if (threshold <= 0 || clock < dayStartMinutes(schedule) || first !== localDay(startedAt, timeZone)) return first;
  const untilNight = (nightMinutes(schedule) - clock + DAY_MINUTES) % DAY_MINUTES;
  return untilNight < threshold ? shiftDate(first, 1) : first;
}

/** Когда человек последний раз был в разговоре. */
const lastActivity = (run: FlowRun) => Math.max(run.startedAt, run.enteredAt, run.lastHumanAt ?? 0, run.lastAgentAt ?? 0);

/**
 * Начало первого дня в поясе человека. Записанный якорь в том же поясе — как есть. Пояс сменился (FR-207): если разговор
 * ещё в первом дне — первый день считается заново по новому поясу, позже — номер дня сохраняется, а сроки идут по новым часам.
 */
export function dayAnchor(run: FlowRun, timeZone: string, schedule: FlowSchedule): number {
  const fresh = () => dayStartAt(firstDayOf(run.startedAt, timeZone, schedule), timeZone, schedule);
  const stored = run.dayAnchorAt;
  if (stored === undefined) return fresh();
  if (clockMinutes(stored, timeZone) === dayStartMinutes(schedule)) return stored;
  // Ближайшее к прежнему якорю начало дня в новом поясе.
  const around = localDay(stored, timeZone);
  const moved = [-1, 0, 1]
    .map((shift) => dayStartAt(shiftDate(around, shift), timeZone, schedule))
    .reduce((best, candidate) => (Math.abs(candidate - stored) < Math.abs(best - stored) ? candidate : best));
  const dayNow = daysBetween(localDay(moved, timeZone), dayInProgress(lastActivity(run), timeZone, schedule)) + 1;
  return dayNow <= 1 ? fresh() : moved;
}

const anchorDate = (run: FlowRun, timeZone: string, schedule: FlowSchedule) => localDay(dayAnchor(run, timeZone, schedule), timeZone);

/** Срок таймера «нода длится N дней»: начало дня входа в ноду + N. Вход до первого дня — как вход в первый день. */
export function stateDaysDue(run: FlowRun, days: number, timeZone: string, schedule: FlowSchedule): number {
  const entered = later(dayOf(run.enteredAt, timeZone, schedule), anchorDate(run, timeZone, schedule));
  return dayStartAt(shiftDate(entered, days), timeZone, schedule);
}

/** Срок таймера «наступил день N сценария»: начало дня N от якоря первого дня. Уже наступил — срок в прошлом. */
export function programDayDue(run: FlowRun, day: number, timeZone: string, schedule: FlowSchedule): number {
  return dayStartAt(shiftDate(anchorDate(run, timeZone, schedule), day - 1), timeZone, schedule);
}

/** День сценария сейчас. Якорь — `dayAnchor`; порог позднего старта — `schedule.lateStartHours` (→ В1). */
export function flowDay(run: FlowRun, now: number, timeZone: string, schedule: FlowSchedule): FlowDayInfo {
  const first = anchorDate(run, timeZone, schedule);
  const current = later(dayInProgress(now, timeZone, schedule), shiftDate(first, -1));
  const day = Math.max(0, daysBetween(first, current) + 1);
  const today = day === 0 ? shiftDate(first, -1) : current;
  return {
    day,
    ...(schedule.lengthDays !== undefined && { totalDays: schedule.lengthDays }),
    isLastDay: schedule.lengthDays !== undefined && day === schedule.lengthDays,
    dayStartedAt: dayStartAt(today, timeZone, schedule),
    nextDayStartAt: dayStartAt(shiftDate(today, 1), timeZone, schedule),
  };
}

/** «Срок вышел»: начало дня `lengthDays + 1`. Срока нет — `null`. */
export function deadlineAt(run: FlowRun, timeZone: string, schedule: FlowSchedule): number | null {
  if (schedule.lengthDays === undefined) return null;
  return dayStartAt(shiftDate(anchorDate(run, timeZone, schedule), schedule.lengthDays), timeZone, schedule);
}

/** Идёт первый день сценария (или вечер перед ним) и первая ночь ещё не наступила: окно, чтобы узнать город (→ В1). */
export function beforeFirstNight(run: FlowRun, now: number, timeZone: string, schedule: FlowSchedule): boolean {
  const first = anchorDate(run, timeZone, schedule);
  const nightDate = eveningNight(schedule) ? first : shiftDate(first, 1);
  return now < zonedTime(dateOf(nightDate), nightMinutes(schedule), timeZone);
}

/** Тот же `run` с якорем первого дня в поясе человека: записать в состояние чата. Без «Дней и времени» — как есть. */
export function withDayAnchor(run: FlowRun, timeZone: string, schedule: FlowSchedule | undefined): FlowRun {
  if (!schedule) return run;
  const dayAnchorAt = dayAnchor(run, timeZone, schedule);
  return run.dayAnchorAt === dayAnchorAt ? run : { ...run, dayAnchorAt };
}

/** Местные часы человека «ЧЧ:ММ». */
export function clockText(at: number, timeZone: string): string {
  const { hour, minute } = zonedParts(at, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
