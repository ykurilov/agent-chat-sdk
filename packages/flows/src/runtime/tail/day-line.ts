import type { FlowTailPart } from "./tail-part";
import { clockText, flowDay } from "../../engine/flow-days";
import { localDay } from "../../engine/zoned-time";

// «День 2 из 3. Сейчас 14:20 (Новосибирск).», «День 3 из 3 — сегодня последний день. …». Только в хвосте запроса:
// постоянная инструкция от дня не зависит.

/** Город пояса по-русски («Новосибирск»); не нашлось — сам пояс. */
function placeOf(timeZone: string, at: number): string {
  try {
    const part = new Intl.DateTimeFormat("ru-RU", { timeZone, timeZoneName: "shortGeneric" }).formatToParts(at).find((item) => item.type === "timeZoneName");
    return part?.value || timeZone;
  } catch {
    return timeZone;
  }
}

export const dayLine: FlowTailPart = ({ flow, run, now, timeZone = "UTC" }) => {
  const { schedule } = flow;
  if (!schedule || run.endedAt !== undefined) return null;
  const info = flowDay(run, now, timeZone, schedule);
  const clock = `Сейчас ${clockText(now, timeZone)} (${placeOf(timeZone, now)}).`;
  if (info.day === 0) {
    const when = localDay(info.nextDayStartAt, timeZone) === localDay(now, timeZone) ? "сегодня" : "завтра";
    return `Первый день начнётся ${when} в ${schedule.dayStart}. ${clock}`;
  }
  if (info.totalDays === undefined) return `День ${info.day}. ${clock}`;
  const day = Math.min(info.day, info.totalDays);
  return day === info.totalDays ? `День ${day} из ${info.totalDays} — сегодня последний день. ${clock}` : `День ${day} из ${info.totalDays}. ${clock}`;
};
