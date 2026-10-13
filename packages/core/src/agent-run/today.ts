/** Начало части с датой: по нему её узнают в запросе. */
export const TODAY_PREFIX = "Сегодня: ";

/** Имя пояса из базы IANA: «UTC», «Europe/Moscow», «America/Argentina/Buenos_Aires», «Etc/GMT-8». */
const IANA_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;
const ZONE_NAME_MAX_LENGTH = 64;

/**
 * Часовой пояс из запроса или настройки: настоящий IANA-пояс — он и есть, остальное (смещение «+08:00», выдуманное
 * имя, не строка) — `undefined`, тогда дата по поясу сервера.
 */
export function resolveTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > ZONE_NAME_MAX_LENGTH || !IANA_ZONE_NAME.test(value)) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}

const HOUR_MS = 3_600_000;

/**
 * Один ли это пояс для дат: разные имена одного пояса (`Asia/Calcutta` и `Asia/Kolkata`, `US/Eastern` и
 * `America/New_York`) — один. Intl сводит имя к основному, а где не сводит, сверяем часы обоих поясов каждый
 * час на год вперёд: везде одинаковые — даты по ним тоже одинаковые. Пояса уже проверены `resolveTimeZone`.
 */
export function sameTimeZone(first: string, second: string, now = new Date()): boolean {
  const canonical = (zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  if (canonical(first) === canonical(second)) return true;
  const clock = (zone: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const [firstClock, secondClock] = [clock(first), clock(second)];
  for (let moment = now.getTime(); moment < now.getTime() + 366 * 24 * HOUR_MS; moment += HOUR_MS) {
    if (firstClock.format(moment) !== secondClock.format(moment)) return false;
  }
  return true;
}

/**
 * Сегодняшняя дата для хвоста запроса (FR-056): «Сегодня: пятница, 2 октября 2026 г.». Часовой пояс — человека
 * (`timeZone`, уже проверенный), без него — сервера. Берётся один раз за ход, в начало запроса не идёт: кэш модели цел.
 */
export function todayBlock(now: Date, timeZone?: string): string {
  const format = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(timeZone && { timeZone }),
  });
  return `${TODAY_PREFIX}${format.format(now)}`;
}
