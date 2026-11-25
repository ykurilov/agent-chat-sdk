import type { FlowEndReason } from "../../engine/flow-run";
import type { FlowDuration } from "../../format/flow-format";
import { FLOW_UNIT_MS, flowDurationMs } from "../../format/flow-duration";
import type { FlowTailPart } from "./tail-part";

// «Пауза: человек не писал 2 месяца, его прошлое сообщение — 3 сентября 2026 г. Разговор уже закончен (срок программы
// вышел) — человек пишет после конца.» Только факт, без правила поведения: правило — у приложения. Только в хвосте шага:
// постоянная инструкция и история от паузы не зависят.

const { min: MINUTE, h: HOUR, d: DAY } = FLOW_UNIT_MS;

/** Русское число со словом: 1 день, 2 дня, 5 дней. */
function counted(count: number, [one, few, many]: readonly [string, string, string]): string {
  const tens = count % 100;
  const units = count % 10;
  const word = tens >= 11 && tens <= 14 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many;
  return `${count} ${word}`;
}

const WORDS = {
  minute: ["минуту", "минуты", "минут"],
  hour: ["час", "часа", "часов"],
  day: ["день", "дня", "дней"],
  month: ["месяц", "месяца", "месяцев"],
  year: ["год", "года", "лет"],
} as const;

/** Полных календарных месяцев между моментами по поясу. */
function fullMonths(from: number, to: number, timeZone: string): number {
  const parts = (at: number) => {
    const values = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(at);
    const get = (type: string) => Number(values.find((part) => part.type === type)?.value);
    return { year: get("year"), month: get("month"), day: get("day") };
  };
  const a = parts(from);
  const b = parts(to);
  return (b.year - a.year) * 12 + (b.month - a.month) - (b.day < a.day ? 1 : 0);
}

/** Сколько прошло словами: «40 минут», «5 часов», «12 дней», «2 месяца», «1 год 3 месяца». */
export function pauseText(from: number, to: number, timeZone: string): string {
  const ms = Math.max(0, to - from);
  if (ms < HOUR) return counted(Math.max(1, Math.floor(ms / MINUTE)), WORDS.minute);
  if (ms < DAY) return counted(Math.floor(ms / HOUR), WORDS.hour);
  const months = fullMonths(from, to, timeZone);
  if (ms < 30 * DAY || months < 1) return counted(Math.floor(ms / DAY), WORDS.day);
  if (months < 12) return counted(months, WORDS.month);
  const rest = months % 12;
  return rest === 0 ? counted(Math.floor(months / 12), WORDS.year) : `${counted(Math.floor(months / 12), WORDS.year)} ${counted(rest, WORDS.month)}`;
}

const END_REASONS: Record<string, string> = {
  final: "программа пройдена до конца",
  deadline: "срок программы вышел",
  abandoned: "человек долго молчал",
  blocked: "канал был недоступен",
};

const endText = (reason: FlowEndReason | undefined) => {
  const known = reason ? END_REASONS[reason] : undefined;
  return known ? `Разговор уже закончен (${known}) — человек пишет после конца.` : "Разговор уже закончен — человек пишет после конца.";
};

function dateText(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(at);
  }
}

export const pauseLine: FlowTailPart = ({ run, now, timeZone = "UTC" }) => {
  const pause = run.humanPause;
  if (!pause) return null;
  const at = run.lastHumanAt ?? now;
  const lines = [`Пауза: человек не писал ${pauseText(pause.previousAt, at, timeZone)}, его прошлое сообщение — ${dateText(pause.previousAt, timeZone)}.`];
  if (run.endedAt !== undefined) lines.push(endText(run.endReason));
  else if (run.reopenedAt !== undefined && run.reopenedAt > pause.previousAt) lines.push("Разговор был закончен и открыт заново.");
  return lines.join(" ");
};

/** Порог `pauseNotice.after` в мс. Не срок «число > 0 и min/h/d» — `TypeError` при создании сценария. */
export function pauseNoticeMs(setting: { after: FlowDuration }): number {
  const after = setting?.after;
  if (!after || !Object.hasOwn(FLOW_UNIT_MS, after.unit) || typeof after.amount !== "number" || !Number.isFinite(after.amount) || after.amount <= 0) {
    throw new TypeError("createAgentFlow: pauseNotice.after — срок { amount: число больше 0, unit: \"min\" | \"h\" | \"d\" }");
  }
  return flowDurationMs(after);
}
