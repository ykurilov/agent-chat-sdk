import type { FlowFirstReason } from "../engine/nudges";
import type { FlowCondition } from "../format/flow-format";
import { russianFlowNoticeLabels, type FlowNoticeLabels } from "../labels/notices";
import { FLOW_TIMER_NOTICE } from "../runtime/prepare-turn";
import { FLOW_DEADLINE_NOTICE } from "../runtime/flow-finish";

const MINUTE = 60_000;

/** Пометка приложения, как её отдаёт экран чата (`AppNotice` из `@ykurilov/agent-chat-react`). */
export interface FlowNoticeInput {
  name: string;
  data: unknown;
}

/** Строки пометок для `noticeLines` у `AgentChat`: имя пометки → строка; данные не те — `undefined`, строки нет. */
export type FlowNoticeLines = Record<string, (notice: FlowNoticeInput) => string | undefined>;

interface FirstMessageData {
  reasons: FlowFirstReason[];
  silentMs?: number;
  exit?: { stateTitle?: string; when?: FlowCondition };
}

/**
 * Строки «Агент написал первым — человек молчал 1 ч 7 мин» для пометок сценария (`flow_timer`, `flow_deadline`):
 * `<AgentChat noticeLines={flowNoticeLines()} />`. Видны, только если право чата `appNotices` включено. Подписи —
 * `russianFlowNoticeLabels` (по умолчанию), `englishFlowNoticeLabels` или свои.
 */
export function flowNoticeLines(labels: FlowNoticeLabels = russianFlowNoticeLabels): FlowNoticeLines {
  const line = ({ data }: FlowNoticeInput) => {
    const parsed = firstMessageData(data);
    return parsed ? noticeLine(parsed, labels) : undefined;
  };
  return { [FLOW_TIMER_NOTICE]: line, [FLOW_DEADLINE_NOTICE]: line };
}

function firstMessageData(data: unknown): FirstMessageData | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { reasons, silentMs, exit } = data as Partial<Record<keyof FirstMessageData, unknown>>;
  if (!Array.isArray(reasons) || reasons.length === 0) return undefined;
  return {
    reasons: reasons.filter((reason): reason is FlowFirstReason => typeof reason === "object" && reason !== null && typeof reason.kind === "string"),
    ...(typeof silentMs === "number" && Number.isFinite(silentMs) && { silentMs }),
    ...(typeof exit === "object" && exit !== null && { exit: exit as FirstMessageData["exit"] }),
  };
}

function noticeLine({ reasons, silentMs, exit }: FirstMessageData, labels: FlowNoticeLabels): string | undefined {
  const silentFor = silentMs === undefined ? undefined : labels.silentFor(durationText(silentMs, labels));
  const parts = reasons.flatMap((reason): string[] => {
    switch (reason.kind) {
      case "silence":
        return [silentFor ?? labels.silence];
      case "morning":
        return [labels.morning];
      case "daily":
        return [labels.daily(reason.at)];
      case "night_messages":
        return [labels.nightMessages(reason.count)];
      case "farewell":
        return [labels.farewell];
      case "transition":
        return [deadlineLine(exit, labels)];
      default:
        return [];
    }
  });
  if (parts.length === 0) return undefined;
  // Длительность — одна на строку: у касания по тишине она уже названа.
  const withSilence = silentFor && !reasons.some((reason) => reason.kind === "silence") ? [...parts, silentFor] : parts;
  return labels.wroteFirst(withSilence.join(labels.separator));
}

function deadlineLine(exit: FirstMessageData["exit"], labels: FlowNoticeLabels): string {
  const when = exit?.when;
  const title = typeof exit?.stateTitle === "string" && exit.stateTitle ? exit.stateTitle : undefined;
  const condition = when?.type === "timer" ? timerText(when, labels) : undefined;
  return when?.type === "timer" && when.from === "since_start" ? labels.overallDeadline(condition, title) : labels.stateDeadline(condition, title);
}

const UNIT_MS = { min: MINUTE, h: 60 * MINUTE, d: 24 * 60 * MINUTE } as const;

function timerText(when: Extract<FlowCondition, { type: "timer" }>, labels: FlowNoticeLabels): string | undefined {
  const { conditions } = labels;
  switch (when.from) {
    case "state_days":
      return conditions.stateDays(durationText(when.days * UNIT_MS.d, labels));
    case "program_day":
      return conditions.programDay(when.day);
    case "time_of_day":
      return conditions.timeOfDay(when.at);
    default: {
      const span = UNIT_MS[when.unit as keyof typeof UNIT_MS];
      if (span === undefined) return undefined;
      const duration = durationText(when.amount * span, labels);
      return when.from === "silence" ? conditions.silence(duration) : when.from === "in_state" ? conditions.inState(duration) : conditions.sinceStart(duration);
    }
  }
}

/** «1 д 3 ч 20 мин»; меньше минуты — `lessThanMinute`. */
function durationText(ms: number, labels: FlowNoticeLabels): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 1) return labels.lessThanMinute;
  const { day, hour, minute } = labels.units;
  return (
    [
      [Math.floor(minutes / (24 * 60)), day],
      [Math.floor(minutes / 60) % 24, hour],
      [minutes % 60, minute],
    ] as Array<[number, string]>
  )
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount} ${unit}`)
    .join(" ");
}
