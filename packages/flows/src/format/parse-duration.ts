// Длительность словами — поле «своё время» тестового чата: «15 мин», «1 ч 30 мин», «2 дня», «1h 30m», «2 days».

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Единица по слову: русские и английские формы с сокращениями. */
const UNIT_MS: Record<string, number> = Object.fromEntries([
  ...["м", "мин", "минута", "минуты", "минут", "минуту", "m", "min", "mins", "minute", "minutes"].map((word) => [word, MINUTE_MS]),
  ...["ч", "час", "часа", "часов", "h", "hr", "hrs", "hour", "hours"].map((word) => [word, HOUR_MS]),
  ...["д", "дн", "день", "дня", "дней", "d", "day", "days"].map((word) => [word, DAY_MS]),
]);

/** Число с единицей; между частями — пробелы, запятые, «и», «and». */
const PART = /\s*(\d+(?:[.,]\d+)?)\s*([a-zа-яё]+)\.?\s*(?:(?:,|и(?![a-zа-яё])|and(?![a-zа-яё]))\s*)?/uy;

/**
 * Длительность словами в мс: «15 мин» → 900 000, «1 ч 30 мин», «2 дня», «1h 30m», «2 days». Каждое число — со своей
 * единицей; непонятное, пустое или ноль — `undefined`.
 */
export function parseDuration(text: string): number | undefined {
  const input = text.trim().toLowerCase();
  if (!input) return undefined;
  PART.lastIndex = 0;
  let total = 0;
  while (PART.lastIndex < input.length) {
    const match = PART.exec(input);
    const unit = match ? UNIT_MS[match[2]!] : undefined;
    if (!match || unit === undefined) return undefined;
    total += Number(match[1]!.replace(",", ".")) * unit;
  }
  return total > 0 ? Math.round(total) : undefined;
}
