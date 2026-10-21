import type { AgentFlow, FlowSchedule, FlowTimerUnit, TimerCondition } from "../format/flow-format";
import type { FlowRun } from "./flow-run";
import { activeExits, stateById } from "./flow-graph";
import { exitTarget } from "./targets";
import { nextClockTime, parseClock } from "./zoned-time";
import { deadlineAt, programDayDue, stateDaysDue } from "./flow-days";
import { giveUpAt, nextMorning, nextNightReply, nextNudge, type FirstWakeContext, type FlowFirstReason } from "./nudges";

/** `exitId` срока «срок вышел» в `FlowDue`: это не выход ноды, а конец разговора (`schedule.lengthDays`). */
export const FLOW_DEADLINE_EXIT = "@deadline";

export interface FlowDue {
  /** Когда сработает, мс с 1970 года. */
  at: number;
  exitId: string;
}

const UNIT_MS: Readonly<Record<FlowTimerUnit, number>> = { min: 60_000, h: 3_600_000, d: 86_400_000 };

/** Когда на самом деле вошли в текущее состояние. `enteredAt` после «назад» сдвинут на остановленные часы — время суток от него не считается. */
function actualEntry(run: FlowRun): number {
  const last = run.path.at(-1);
  return last && last.state === run.state ? last.at : run.enteredAt;
}

/**
 * Срок одного таймера в текущем состоянии чата; `null` — сейчас не идёт (тишины нет: человек ответил или агент ещё не писал).
 * «Нода длится N дней» и «наступил день N» считаются по «Дням и времени»: без `schedule` не идут.
 */
export function timerDueAt(condition: TimerCondition, run: FlowRun, timeZone: string, schedule?: FlowSchedule): number | null {
  switch (condition.from) {
    case "in_state":
      return run.enteredAt + condition.amount * UNIT_MS[condition.unit];
    case "since_start":
      return run.startedAt + condition.amount * UNIT_MS[condition.unit];
    case "silence":
      if (run.lastAgentAt === null) return null;
      if (run.lastHumanAt !== null && run.lastHumanAt > run.lastAgentAt) return null;
      // После открытия заново тишина считается от открытия.
      return Math.max(run.lastAgentAt, run.reopenedAt ?? 0) + condition.amount * UNIT_MS[condition.unit];
    case "time_of_day": {
      const minutes = parseClock(condition.at);
      return minutes === null ? null : nextClockTime(actualEntry(run), minutes, timeZone);
    }
    case "state_days":
      return schedule ? stateDaysDue(run, condition.days, timeZone, schedule) : null;
    case "program_day":
      return schedule ? programDayDue(run, condition.day, timeZone, schedule) : null;
  }
}

/** Таймеры, чей срок не зависит от момента входа в состояние: от начала разговора или дня программы. */
const ENTRY_FREE_TIMERS: ReadonlySet<TimerCondition["from"]> = new Set(["since_start", "program_day"]);

/**
 * Выход по таймеру, который уже наступил к входу в состояние и срок которого от входа не зависит: срабатывает сразу, в том
 * же шаге, а не отдельным ходом. Тишина, время в состоянии, «длится N дней», время суток — нет: их срок от входа. Нет — `null`.
 */
export function overdueOnEntry(flow: AgentFlow, run: FlowRun, now: number, timeZone: string): string | null {
  const state = stateById(flow, run.state);
  if (!state) return null;
  let best: FlowDue | null = null;
  for (const { exit } of activeExits(flow, state)) {
    if (exit.when.type !== "timer" || !ENTRY_FREE_TIMERS.has(exit.when.from) || !exitTarget(flow, run, exit.to)) continue;
    const at = timerDueAt(exit.when, run, timeZone, flow.schedule);
    // Как `nextDue`: самый ранний срок, при равенстве — порядок в ноде.
    if (at !== null && at <= now && (best === null || at < best.at)) best = { at, exitId: exit.id };
  }
  return best?.exitId ?? null;
}

/**
 * Ближайший таймер чата: побеждает наступивший раньше, при равенстве — таймер состояния. «Срок вышел» побеждает и при
 * равенстве: разговор кончается, а не переходит. Законченный разговор сроков не имеет. `timeZone` — пояс человека.
 */
export function nextDue(flow: AgentFlow, run: FlowRun, _now: number, timeZone: string): FlowDue | null {
  if (run.endedAt !== undefined) return null;
  const state = stateById(flow, run.state);
  if (!state) return null;
  let best: FlowDue | null = null;
  for (const { exit } of activeExits(flow, state)) {
    if (exit.when.type !== "timer" || !exitTarget(flow, run, exit.to)) continue;
    const at = timerDueAt(exit.when, run, timeZone, flow.schedule);
    // Свои условия идут первыми: общий таймер забирает срок, только если наступает строго раньше.
    if (at !== null && (best === null || at < best.at)) best = { at, exitId: exit.id };
  }
  const deadline = flow.schedule ? deadlineAt(run, timeZone, flow.schedule) : null;
  if (deadline !== null && (best === null || deadline <= best.at)) best = { at: deadline, exitId: FLOW_DEADLINE_EXIT };
  return best;
}

// ---------- «Пишет первым»: касания, утро, накопленное (этап 7) ----------

/** `exitId` срока «пишет первым» в `FlowDue`: касание, утреннее или ответ на накопленное, без перехода. */
export const FLOW_FIRST_EXIT = "@first";
/** `exitId` срока «не завершил»: конец разговора без сообщения. */
export const FLOW_GIVE_UP_EXIT = "@give_up";

/** Сроки «пишет первым»: каждая причина со своим моментом. */
function firstMessageDues(flow: AgentFlow, run: FlowRun, now: number, timeZone: string, context: FirstWakeContext) {
  const nudge = nextNudge(flow, run, now, timeZone, context);
  const morning = nextMorning(flow, run, timeZone, context);
  const night = nextNightReply(flow, run, timeZone, context);
  const dues: Array<{ at: number; reason: FlowFirstReason }> = [];
  if (morning !== null) dues.push({ at: morning, reason: { kind: "morning" } });
  if (night !== null) dues.push({ at: night, reason: { kind: "night_messages", count: context.unanswered ?? 0 } });
  if (nudge && nudge.reason.kind !== "give_up") dues.push({ at: nudge.at, reason: nudge.reason });
  return { dues, giveUp: nudge?.reason.kind === "give_up" ? nudge.at : null, ownNudge: nudge?.own === true };
}

/**
 * Ближайший срок чата: переход ноды, «срок вышел», «не завершил» или «пишет первым». При равенстве побеждает «срок
 * вышел», затем «не завершил» (разговор кончается), затем таймер ноды: причины «пишет первым» того же момента он заберёт с собой.
 */
export function nextWake(flow: AgentFlow, run: FlowRun, now: number, timeZone: string, context: FirstWakeContext = {}): FlowDue | null {
  if (run.endedAt !== undefined) return null;
  let best = nextDue(flow, run, now, timeZone);
  const { dues, giveUp } = firstMessageDues(flow, run, now, timeZone, context);
  const deadlineFirst = best?.exitId === FLOW_DEADLINE_EXIT;
  if (giveUp !== null && (best === null || giveUp < best.at || (giveUp === best.at && !deadlineFirst))) best = { at: giveUp, exitId: FLOW_GIVE_UP_EXIT };
  for (const due of dues) if (best === null || due.at < best.at) best = { at: due.at, exitId: FLOW_FIRST_EXIT };
  return best;
}

/** Что наступило к `now`: конец разговора, переход ноды и все причины написать первым — на один ход. */
export interface DueReasons {
  /** «Срок вышел»: остальное не считается. */
  deadline: boolean;
  /** «Не завершил»: конец без сообщения. */
  giveUp: boolean;
  /** Наступивший выход ноды по таймеру. */
  exitId: string | null;
  /** Утро, накопленное, касание — по порядку. Переход ноды в них не входит: его причину даёт сам переход. */
  reasons: FlowFirstReason[];
  /** Касание в причинах — своего ряда ноды на N дней: шаг помечается, общий ряд потом начнётся сначала. */
  ownNudge?: boolean;
}

export function dueReasons(flow: AgentFlow, run: FlowRun, now: number, timeZone: string, context: FirstWakeContext = {}): DueReasons {
  const none: DueReasons = { deadline: false, giveUp: false, exitId: null, reasons: [] };
  if (run.endedAt !== undefined) return none;
  const exit = nextDue(flow, run, now, timeZone);
  // Срок — сам по себе: переход ноды, который наступил раньше, но ждёт хода (касание отложено), его не заслоняет.
  const deadline = flow.schedule ? deadlineAt(run, timeZone, flow.schedule) : null;
  if (deadline !== null && deadline <= now) return { ...none, deadline: true };
  const { dues, giveUp, ownNudge } = firstMessageDues(flow, run, now, timeZone, context);
  if (giveUp !== null && giveUp <= now) return { ...none, giveUp: true };
  const exitId = exit && exit.at <= now ? exit.exitId : null;
  // Новая нода — свой разговор: касание по тишине старой ноды уже не к месту. Утреннее тоже заменяет касание: ряд после
  // него начинается заново, хвост вчерашнего ряда (ночь, потолок дня) не уходит.
  const morning = dues.some((due) => due.at <= now && due.reason.kind === "morning");
  const reasons = dues.filter((due) => due.at <= now && !((exitId || morning) && (due.reason.kind === "silence" || due.reason.kind === "daily"))).map((due) => due.reason);
  const nudged = reasons.some((reason) => reason.kind === "silence" || reason.kind === "daily");
  return { ...none, exitId, reasons, ...(ownNudge && nudged && { ownNudge: true }) };
}

/** Ближайший срок «пишет первым» строго после `now`: касание, утреннее, накопленное. Нет — `null`. */
export function nextFirstMessageAfter(flow: AgentFlow, run: FlowRun, now: number, timeZone: string, context: FirstWakeContext = {}): number | null {
  if (run.endedAt !== undefined) return null;
  const ahead = firstMessageDues(flow, run, now, timeZone, context).dues.filter((due) => due.at > now);
  return ahead.length === 0 ? null : Math.min(...ahead.map((due) => due.at));
}

/** Ближайший конец разговора после `now`: «срок вышел» или «не завершил». Нет — `null`. */
export function endingWake(flow: AgentFlow, run: FlowRun, now: number, timeZone: string, context: FirstWakeContext): FlowDue | null {
  if (run.endedAt !== undefined) return null;
  const deadline = flow.schedule ? deadlineAt(run, timeZone, flow.schedule) : null;
  const giveUp = giveUpAt(flow, run, timeZone, context);
  const candidates: FlowDue[] = [
    ...(deadline !== null && deadline > now ? [{ at: deadline, exitId: FLOW_DEADLINE_EXIT }] : []),
    ...(giveUp !== null && giveUp > now ? [{ at: giveUp, exitId: FLOW_GIVE_UP_EXIT }] : []),
  ];
  return earliest(candidates);
}

const earliest = (dues: FlowDue[]): FlowDue | null => dues.reduce<FlowDue | null>((best, due) => (best === null || due.at < best.at ? due : best), null);

/**
 * Касание отложено (нельзя писать сейчас, ход не начался): срок — повтор `retry`, но не позже ближайшего срока, который не
 * касание: выход ноды, «срок вышел», «не завершил». Конец разговора не зависит от того, дошло ли касание. Сроки не позже
 * `now` (наступивший выход, который ждёт хода) не в счёт. `retry.at: null` — повтора нет. Ничего нет — `null`.
 */
export function deferredWake(
  flow: AgentFlow,
  run: FlowRun,
  now: number,
  timeZone: string,
  context: FirstWakeContext,
  retry: { at: number | null; exitId: string },
): FlowDue | null {
  if (run.endedAt !== undefined) return null;
  const exit = nextDue(flow, run, now, timeZone);
  const ending = endingWake(flow, run, now, timeZone, context);
  return earliest([
    ...(exit && exit.at > now && exit.exitId !== FLOW_DEADLINE_EXIT ? [exit] : []),
    ...(ending ? [ending] : []),
    ...(retry.at !== null ? [{ at: Math.max(retry.at, now), exitId: retry.exitId }] : []),
  ]);
}
