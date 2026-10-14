// Время на часах человека без сторонних библиотек: дата и часы в его поясе и обратно — в миллисекунды.

export interface ZonedDate {
  year: number;
  /** 1…12 */
  month: number;
  day: number;
}

export interface ZonedParts extends ZonedDate {
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    };
    try {
      formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
    } catch {
      // Неизвестный пояс: считаем по UTC. Предупредить о нём — дело сервера, движок чистый.
      formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Дата и часы на часах человека в момент `at`. */
export function zonedParts(at: number, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** На сколько мс часы пояса впереди UTC в момент `at`. */
function offsetAt(at: number, timeZone: string): number {
  const parts = zonedParts(at, timeZone);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/** Момент, когда на часах человека будет `date` и `minutes` минут от полуночи. */
export function zonedTime(date: ZonedDate, minutes: number, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  return second;
}

/** Следующий календарный день. */
export function nextDate(date: ZonedDate, days = 1): ZonedDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** «ЧЧ:ММ» → минуты от полуночи; не то — `null`. */
export function parseClock(clock: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Минуты от полуночи на часах человека. */
export function clockMinutes(at: number, timeZone: string): number {
  const parts = zonedParts(at, timeZone);
  return parts.hour * 60 + parts.minute;
}

/** Первый момент строго после `after`, когда на часах человека `minutes` минут от полуночи. */
export function nextClockTime(after: number, minutes: number, timeZone: string): number {
  let date: ZonedDate = zonedParts(after, timeZone);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = zonedTime(date, minutes, timeZone);
    if (candidate > after) return candidate;
    date = nextDate(date);
  }
  return zonedTime(date, minutes, timeZone);
}

/** Начало следующих суток на часах человека. */
export function startOfNextDay(at: number, timeZone: string): number {
  return zonedTime(nextDate(zonedParts(at, timeZone)), 0, timeZone);
}

/** Сутки человека: «ГГГГ-ММ-ДД» в его поясе. */
export function localDay(at: number, timeZone: string): string {
  const { year, month, day } = zonedParts(at, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
