import type { AgentFlow, FlowDuration, FlowNudges, FlowSchedule } from "../format/flow-format";
import type { FlowRun } from "./flow-run";
import { stateById } from "./flow-graph";
import { flowDay, programDayDue } from "./flow-days";
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
  /** Касание своего ряда ноды на N дней (`nudges.days`): его шаг не идёт в счёт общего ряда. */
  own?: boolean;
}

/** Касания ноды: свои, «off», общие из «Дней и времени», общие сценария. Нет ни тех, ни других — `null`. */
export function stateNudges(flow: AgentFlow, stateId: string): FlowNudges | null {
  const own = stateById(flow, stateId)?.nudges;
  if (own === "off") return null;
  return own ?? flow.schedule?.nudges ?? flow.nudges ?? null;
}

/** Без «Дней и времени» дни своего ряда — календарные, по поясу человека. */
const CALENDAR_DAYS: FlowSchedule = { dayStart: "00:00", lateStartHours: 0, farewellOnDeadline: false };

/** Ряд касаний ноды и, если свой ряд ограничен днями, момент их конца и общий ряд после. */
interface NudgeRings {
  ring: FlowNudges;
  /** Начало дня, с которого свой ряд уступает общему; нет — ряд на всё время в ноде. */
  until?: number;
  after?: FlowNudges | null;
}

function nudgeRings(flow: AgentFlow, run: FlowRun, timeZone: string): NudgeRings | null {
  const own = stateById(flow, run.state)?.nudges;
  if (own === "off") return null;
  const common = flow.schedule?.nudges ?? flow.nudges ?? null;
  if (!own) return common && { ring: common };
  if (own.days === undefined) return { ring: own };
  const schedule = flow.schedule ?? CALENDAR_DAYS;
  const entryDay = flowDay(run, run.enteredAt, timeZone, schedule).day;
  return { ring: own, until: programDayDue(run, entryDay + own.days, timeZone, schedule), after: common };
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
  const rings = nudgesRunning(flow, run, timeZone, context);
  if (!rings || run.lastAgentAt === null) return null;
  // Ответ сотрудника — слова агента (FR-507): тишина идёт от конца паузы.
  const base = Math.max(run.lastAgentAt, context.pausedUntil ?? 0, context.undeliveredAt ?? 0);
  const step = run.nudgeStep ?? 0;
  let nudge: NudgeDue | null = null;
  if (rings.until === undefined) nudge = ringNudge(rings.ring, base, step, timeZone);
  else {
    // Свой ряд — в свои дни; потом общий ряд с начала, тишина — не раньше начала того дня.
    const own = base < rings.until ? ringNudge(rings.ring, base, step, timeZone) : null;
    if (own && own.at < rings.until) nudge = { ...own, own: true };
    else if (rings.after) nudge = ringNudge(rings.after, Math.max(base, rings.until), run.nudgeStepOwn || base < rings.until ? 0 : step, timeZone);
  }
  const giveUp = giveUpAt(flow, run, timeZone, context);
  // Сервер стоял дольше тишины: пропущенное касание уже не к месту — разговор кончается.
  if (giveUp !== null && (!nudge || giveUp <= nudge.at || giveUp <= now)) return { at: giveUp, reason: { kind: "give_up" } };
  return nudge;
}

/** Шаг ряда `step` от `base`: срок тишины, а после ряда — ближайшие часы `dailyAt`. Ряд кончился — `null`. */
function ringNudge(ring: FlowNudges, base: number, step: number, timeZone: string): NudgeDue | null {
  const silence = ring.afterSilence[step];
  if (silence) return { at: base + durationMs(silence), reason: { kind: "silence", step: step + 1 } };
  let nudge: NudgeDue | null = null;
  for (const clock of ring.dailyAt ?? []) {
    const minutes = parseClock(clock);
    if (minutes === null) continue;
    const at = nextClockTime(base, minutes, timeZone);
    if (!nudge || at < nudge.at) nudge = { at, reason: { kind: "daily", at: clock } };
  }
  return nudge;
}

/** Касания ноды идут: они есть, разговор не кончен, агент писал последним и сообщений без ответа нет. */
function nudgesRunning(flow: AgentFlow, run: FlowRun, timeZone: string, context: FirstWakeContext): NudgeRings | null {
  const rings = nudgeRings(flow, run, timeZone);
  if (!rings || run.endedAt !== undefined || run.lastAgentAt === null) return null;
  if ((run.lastHumanAt !== null && run.lastHumanAt > run.lastAgentAt) || (context.unanswered ?? 0) > 0) return null;
  return rings;
}

/**
 * Когда наступит «не завершил» (`giveUpAfter` тишины человека), независимо от касаний: отложенное или не начатое
 * касание конец разговора не двигает. Нет `giveUpAfter` или тишина не идёт — `null`.
 */
export function giveUpAt(flow: AgentFlow, run: FlowRun, timeZone: string, context: FirstWakeContext = {}): number | null {
  const rings = nudgesRunning(flow, run, timeZone, context);
  // Свой ряд на N дней без своего «не завершил» — общий: тишина человека считается всё время в ноде.
  const giveUpAfter = rings && (rings.ring.giveUpAfter ?? (rings.until !== undefined ? rings.after?.giveUpAfter : undefined));
  // Слова сотрудника на паузе — тоже разговор (FR-507): тишина человека считается и от конца паузы.
  return giveUpAfter ? Math.max(run.lastHumanAt ?? run.startedAt, context.pausedUntil ?? 0) + durationMs(giveUpAfter) : null;
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

/** Касания, которые ждут правила «человек писал недавно»: агент пишет первым без дела, а не по программе или ответу. */
const HELD_AT_DAY_START = new Set<FlowFirstReason["kind"]>(["morning", "silence", "daily"]);

/**
 * До какого момента молчат касания в начале дня: человек писал до начала дня и меньше `skipMorningIfHumanWithinMin`
 * назад — как утреннее, ждут и касание тишины, перенесённое ночью на утро, и касание по часам. Переход ноды по сроку и
 * ответ на ночные сообщения — по делу, они не ждут. Ждать не нужно — `null`.
 */
export function dayStartHoldUntil(flow: AgentFlow, run: FlowRun, now: number, timeZone: string, reasons: readonly FlowFirstReason[]): number | null {
  const schedule = flow.schedule;
  if (!schedule || run.lastHumanAt === null || !reasons.every((reason) => HELD_AT_DAY_START.has(reason.kind))) return null;
  const until = run.lastHumanAt + (schedule.firstMessages?.skipMorningIfHumanWithinMin ?? DEFAULT_SKIP_MORNING_MIN) * 60_000;
  if (until <= now) return null;
  return run.lastHumanAt < flowDay(run, now, timeZone, schedule).dayStartedAt ? until : null;
}

/** Ответить на накопленное: в начале дня после последних записанных в место слов. Сообщений без ответа нет — `null`. */
export function nextNightReply(flow: AgentFlow, run: FlowRun, timeZone: string, context: FirstWakeContext = {}): number | null {
  if (!(context.unanswered ?? 0) || run.endedAt !== undefined) return null;
  const last = Math.max(run.lastAgentAt ?? 0, run.lastHumanAt ?? 0, run.startedAt, context.undeliveredAt ?? 0);
  return flow.schedule ? flowDay(run, last, timeZone, flow.schedule).nextDayStartAt : last;
}
