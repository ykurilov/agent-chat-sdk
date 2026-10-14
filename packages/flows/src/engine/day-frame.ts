import type { FlowSchedule } from "../format/flow-format";
import type { FlowRun } from "./flow-run";
import { dayInProgress } from "./flow-days";

// Рамки дня по числу сообщений человека за день сценария, по plan.md, «Рамки дня и решение о входящем». Чистые функции.

/** `normal` — как обычно; `soft` — сворачиваться (строка хвоста); `last` — готовая фраза `hardText`; `closed` — молчать до утра. */
export type FrameState = "normal" | "soft" | "last" | "closed";

/** Готовая фраза жёсткой рамки, если автор свою не задал. */
export const DEFAULT_HARD_FRAME_TEXT = "На сегодня всё — утром обязательно отвечу!";

/**
 * Состояние рамки дня для `humanMessagesToday`-го сообщения человека за день сценария: на `hardAt`-м — готовая фраза,
 * после — молчание; с `softFrom`-го — сворачиваться. Рамок нет — `normal`.
 */
export function frameState(humanMessagesToday: number, frame: FlowSchedule["dayFrame"]): FrameState {
  if (!frame) return "normal";
  const { softFrom, hardAt } = frame;
  if (hardAt !== undefined && humanMessagesToday > hardAt) return "closed";
  if (hardAt !== undefined && humanMessagesToday === hardAt) return "last";
  if (softFrom !== undefined && humanMessagesToday >= softFrom) return "soft";
  return "normal";
}

/** Готовая фраза жёсткой рамки: автора, иначе по умолчанию. */
export function hardFrameText(frame: FlowSchedule["dayFrame"]): string {
  return frame?.hardText?.trim() || DEFAULT_HARD_FRAME_TEXT;
}

/** Сколько сообщений человека уже посчитано за день сценария, который идёт в `at` (`run.dayCounts`). */
export function humanMessagesToday(run: FlowRun, at: number, timeZone: string, schedule: FlowSchedule): number {
  return run.dayCounts?.[dayInProgress(at, timeZone, schedule)] ?? 0;
}

/** Человек закрыл день (`flow_close_day`, запись `dayClosedOn`), и этот день ещё идёт: сегодня первым не пишем. */
export function dayClosedToday(dayClosedOn: string | null, at: number, timeZone: string, schedule: FlowSchedule): boolean {
  return dayClosedOn !== null && dayClosedOn === dayInProgress(at, timeZone, schedule);
}
