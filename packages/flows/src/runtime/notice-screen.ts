import type { AppNoticeViews } from "@ykurilov/agent-chat-core";
import { FLOW_DEADLINE_NOTICE } from "./flow-finish";
import { FLOW_TIMER_NOTICE } from "./prepare-turn";

// Проекция пометок «пишет первым» для экрана (право `appNotices`): в браузер — только то, что нужно строке
// `flowNoticeLines`. Номера состояний, выходов, шаги ряда и сигналы приложения (`flow_event`) не уходят.

const TIMER_FIELDS = ["type", "from", "days", "day", "at", "amount", "unit"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const scalar = (value: unknown) => typeof value === "string" || typeof value === "number";

/** Причина: вид и простые подробности строки (`at` у расписания, `count` у ночных). */
function screenReason(reason: unknown): Record<string, unknown> | undefined {
  if (!isRecord(reason) || typeof reason.kind !== "string") return undefined;
  return {
    kind: reason.kind,
    ...(reason.kind === "daily" && typeof reason.at === "string" && { at: reason.at }),
    ...(reason.kind === "night_messages" && typeof reason.count === "number" && { count: reason.count }),
  };
}

/** Условие срока — только таймер и только его поля. */
function screenWhen(when: unknown): Record<string, unknown> | undefined {
  if (!isRecord(when) || when.type !== "timer") return undefined;
  return Object.fromEntries(TIMER_FIELDS.flatMap((field) => (scalar(when[field]) ? [[field, when[field]]] : [])));
}

function screenExit(exit: unknown): Record<string, unknown> | undefined {
  if (!isRecord(exit)) return undefined;
  const when = screenWhen(exit.when);
  const stateTitle = typeof exit.stateTitle === "string" ? exit.stateTitle : undefined;
  if (!when && stateTitle === undefined) return undefined;
  return { ...(stateTitle !== undefined && { stateTitle }), ...(when && { when }) };
}

/** Данные пометки «пишет первым» для экрана: `reasons`, `silentMs`, `exit`. Не та форма — `undefined`, пометка не уходит. */
export function flowNoticeScreenData(data: unknown): Record<string, unknown> | undefined {
  if (!isRecord(data) || !Array.isArray(data.reasons)) return undefined;
  const reasons = data.reasons.flatMap((reason) => screenReason(reason) ?? []);
  if (reasons.length === 0) return undefined;
  const exit = screenExit(data.exit);
  return {
    reasons,
    ...(typeof data.silentMs === "number" && Number.isFinite(data.silentMs) && { silentMs: data.silentMs }),
    ...(exit && { exit }),
  };
}

/** Проекции сценария для `appNoticeViews` службы чата: `withChat` добавляет их сам. */
export const FLOW_APP_NOTICE_VIEWS: AppNoticeViews = { [FLOW_TIMER_NOTICE]: flowNoticeScreenData, [FLOW_DEADLINE_NOTICE]: flowNoticeScreenData };
