import type { AgentFlow, FlowDuration, FlowNudges, FlowSchedule } from "../format/flow-format";
import type { FlowRun } from "./flow-run";
import { stateById } from "./flow-graph";
import { flowDay } from "./flow-days";
import { nextClockTime, parseClock } from "./zoned-time";

// Этап 7 сценариев: касания — ход агента в той же ноде, по plan.md, «Касания и „пишет первым“».

/** Почему агент пишет первым. Причины одного срока собираются в один ход. */
export type FlowFirstReason =
  /** Переход по таймеру в новую ноду. */
  | { kind: "transition"; stateId: string }
  /** Утреннее сообщение (`schedule.firstMessages.morning`). */
  | { kind: "morning" }
  /** Касание по тишине: номер шага ряда `afterSilence`, с 1. */
  | { kind: "silence"; step: number }
  /** Касание по часам (`dailyAt`). */
  | { kind: "daily"; at: string }
  /** Сообщения человека остались без ответа (после жёсткой рамки дня, при лимите расходов) — ответить на накопленное. */
  | { kind: "night_messages"; count: number }
  /** Прощание при «срок вышел» (`schedule.farewellOnDeadline`, → В5). */
  | { kind: "farewell" };

/** Ближайшее касание; `give_up` — конец разговора «не завершил» без сообщения. */
export interface NudgeDue {
  at: number;
  reason: FlowFirstReason | { kind: "give_up" };
}

/** Касания ноды: свои, «off», общие из «Дней и времени», общие сценария. Нет ни тех, ни других — `null`. */
export function stateNudges(flow: AgentFlow, stateId: string): FlowNudges | null {
  const own = stateById(flow, stateId)?.nudges;
  if (own === "off") return null;
  return own ?? flow.schedule?.nudges ?? flow.nudges ?? null;
}

const UNIT_MS = { min: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const durationMs = (duration: FlowDuration) => duration.amount * UNIT_MS[duration.unit];

/** Порог утреннего по умолчанию: человек писал за 3 ч до него — утреннее завтра. */
export const DEFAULT_SKIP_MORNING_MIN = 180;

/** То, чего нет в месте чата: пауза сотрудника из записи и сообщения человека без ответа из истории. */
export interface FirstWakeContext {
  /** Пауза сотрудника до этого момента (мс): тишина считается от её конца, утро на паузе пропускается. */
  pausedUntil?: number | null;
  /** Сообщения человека после последнего ответа агента, записанные без хода (ночь, рамка дня, пауза). */
  unanswered?: number;
  /** Последнее касание не доставлено (мс): оно не засчитано, а следующий срок — не раньше этого момента. */
  undeliveredAt?: number | null;
}

/**
 * Ближайшее касание чата: ряд `afterSilence` от последнего ответа агента, после ряда — часы `dailyAt`. `give_up`
 * («не завершил») — `giveUpAfter` тишины человека; побеждает, если наступает не позже касания. Касаний в ноде нет,
 * человек ответил или писал без ответа, агент ещё не писал, разговор закончен — `null`.
 */
export function nextNudge(flow: AgentFlow, run: FlowRun, now: number, timeZone: string, context: FirstWakeContext = {}): NudgeDue | null {
  const nudges = stateNudges(flow, run.state);
  if (!nudges || run.endedAt !== undefined || run.lastAgentAt === null) return null;
  if ((run.lastHumanAt !== null && run.lastHumanAt > run.lastAgentAt) || (context.unanswered ?? 0) > 0) return null;
  // Ответ сотрудника — слова агента (FR-507): тишина идёт от конца паузы.
  const base = Math.max(run.lastAgentAt, context.pausedUntil ?? 0, context.undeliveredAt ?? 0);
  const step = run.nudgeStep ?? 0;
  let nudge: NudgeDue | null = null;
  const silence = nudges.afterSilence[step];
  if (silence) nudge = { at: base + durationMs(silence), reason: { kind: "silence", step: step + 1 } };
  else {
    for (const clock of nudges.dailyAt ?? []) {
      const minutes = parseClock(clock);
      if (minutes === null) continue;
      const at = nextClockTime(base, minutes, timeZone);
      if (!nudge || at < nudge.at) nudge = { at, reason: { kind: "daily", at: clock } };
    }
  }
  if (nudges.giveUpAfter) {
    // Слова сотрудника на паузе — тоже разговор (FR-507): тишина человека считается и от конца паузы.
    const giveUp = Math.max(run.lastHumanAt ?? run.startedAt, context.pausedUntil ?? 0) + durationMs(nudges.giveUpAfter);
    // Сервер стоял дольше тишины: пропущенное касание уже не к месту — разговор кончается.
    if (!nudge || giveUp <= nudge.at || giveUp <= now) return { at: giveUp, reason: { kind: "give_up" } };
  }
  return nudge;
}

/** Пишет ли сценарий утреннее: так задано, а нет — если у программы есть срок. */
const morningOn = (schedule: FlowSchedule) => schedule.firstMessages?.morning ?? schedule.lengthDays !== undefined;

/**
 * Утреннее сообщение: начало следующего дня после последних слов агента. Человек писал меньше чем за
 * `skipMorningIfHumanWithinMin` до него или на нём стояла пауза сотрудника — утреннее следующего дня.
 */
export function nextMorning(flow: AgentFlow, run: FlowRun, timeZone: string, context: FirstWakeContext = {}): number | null {
  const schedule = flow.schedule;
  if (!schedule || !morningOn(schedule) || run.endedAt !== undefined) return null;
  const skipMs = (schedule.firstMessages?.skipMorningIfHumanWithinMin ?? DEFAULT_SKIP_MORNING_MIN) * 60_000;
  // Утреннее не дошло — следующее утро, а не то же сразу.
  const since = Math.max(run.lastAgentAt ?? run.startedAt, context.undeliveredAt ?? 0);
  let morning = flowDay(run, since, timeZone, schedule).nextDayStartAt;
  for (let day = 0; day < 3; day += 1) {
    const humanJustWrote = run.lastHumanAt !== null && run.lastHumanAt < morning && morning - run.lastHumanAt < skipMs;
    const paused = (context.pausedUntil ?? 0) > morning;
    if (!humanJustWrote && !paused) return morning;
    morning = flowDay(run, morning, timeZone, schedule).nextDayStartAt;
  }
  return morning;
}

/** Ответить на накопленное: в начале дня после последних записанных в место слов. Сообщений без ответа нет — `null`. */
export function nextNightReply(flow: AgentFlow, run: FlowRun, timeZone: string, context: FirstWakeContext = {}): number | null {
  if (!(context.unanswered ?? 0) || run.endedAt !== undefined) return null;
  const last = Math.max(run.lastAgentAt ?? 0, run.lastHumanAt ?? 0, run.startedAt, context.undeliveredAt ?? 0);
  return flow.schedule ? flowDay(run, last, timeZone, flow.schedule).nextDayStartAt : last;
}
