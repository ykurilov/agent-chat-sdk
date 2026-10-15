import type { AgentFlow } from "../format/flow-format";
import { FLOW_PATH_LIMIT, type FlowPathEntry, type FlowRun, type Transition } from "./flow-run";
import { isTouch, stateById } from "./flow-graph";

// Как меняется `FlowRun`: старт, переход, сообщение человека, ответ агента. Чистые функции — новый объект на каждый шаг.

/** Чат начинает сценарий в стартовом состоянии. */
export function startRun(flow: AgentFlow, now: number): FlowRun {
  const start = stateById(flow, flow.start);
  if (!start) throw new Error(`Сценарий «${flow.id}» без старта: стартовое состояние не выбрано или его нет.`);
  return {
    state: start.id,
    enteredAt: now,
    startedAt: now,
    path: [{ state: start.id, at: now, tags: start.tags, from: null, exitId: null, decidedBy: "start" }],
    pausedClocks: {},
    notes: {},
    humanMessages: 0,
    agentAnswers: 0,
    sideQuestionAt: null,
    lastRejected: null,
    lastAgentAt: null,
    lastHumanAt: null,
    chain: 0,
  };
}

/** Добавляет шаг в путь, храня последние `FLOW_PATH_LIMIT`. */
export function appendPath(path: FlowPathEntry[], entry: FlowPathEntry): FlowPathEntry[] {
  return [...path, entry].slice(-FLOW_PATH_LIMIT);
}

/**
 * Применяет переход из `nextTransition`. Часы «времени в состоянии» (→ В5): уходя из основного состояния в касание, движок
 * запоминает, сколько там пробыли; «назад» продолжает отсчёт с этого места, обычный вход — с нуля.
 */
export function applyTransition(flow: AgentFlow, run: FlowRun, transition: Transition): FlowRun {
  const from = stateById(flow, transition.from);
  const to = stateById(flow, transition.to);
  let enteredAt = transition.at;
  let pausedClocks: Record<string, number> = {};
  if (transition.returned) {
    enteredAt = transition.at - (run.pausedClocks[transition.to] ?? 0);
  } else if (to && isTouch(to)) {
    // В касание: из основного — часы остановлены, из касания — остаются стоять как были.
    pausedClocks = from && !isTouch(from) ? { [from.id]: transition.at - run.enteredAt } : run.pausedClocks;
  }
  // В основное состояние вошли — прежние остановленные часы больше не понадобятся: «назад» поведёт уже сюда.
  return {
    ...run,
    state: transition.to,
    enteredAt,
    pausedClocks,
    path: appendPath(run.path, {
      state: transition.to,
      at: transition.at,
      tags: transition.tags,
      from: transition.from,
      exitId: transition.exitId,
      decidedBy: transition.decidedBy,
      ...(transition.probability === undefined ? {} : { probability: transition.probability }),
      ...(transition.reason === undefined ? {} : { reason: transition.reason }),
    }),
    chain: run.chain + 1,
    lastRejected: null,
    enteredAfterAnswer: run.answerId,
  };
}

/**
 * Пришло сообщение человека: тишина прервана, счёт переходов подряд — заново, ряд касаний — с первого шага.
 * `dayKey` — местная дата дня сценария («ГГГГ-ММ-ДД»), только у сценариев с днями: по нему считаются рамки дня.
 */
export function noteHumanMessage(run: FlowRun, now: number, dayKey?: string, count = 1): FlowRun {
  return {
    ...run,
    humanMessages: run.humanMessages + count,
    lastHumanAt: now,
    chain: 0,
    ...(run.nudgeStep === undefined ? {} : { nudgeStep: 0 }),
    ...(run.serverTurns === undefined ? {} : { serverTurns: 0 }),
    ...(dayKey === undefined ? {} : { dayCounts: { [dayKey]: (run.dayCounts?.[dayKey] ?? 0) + count } }),
  };
}

/** Агент ответил (или написал первым): от этого момента считается тишина, счёт переходов подряд — заново. */
export function noteAgentAnswer(run: FlowRun, now: number): FlowRun {
  return { ...run, agentAnswers: run.agentAnswers + 1, lastAgentAt: now, chain: 0 };
}

/**
 * Ответ касания не доставлен (FR-309): касание не засчитано — шаг ряда, последние слова агента и счёт ответов как до
 * него. `undeliveredAt` — когда касание было: раньше него следующий срок не наступает. Пометка не меняется — откат тот же
 * сколько ни считай.
 */
export function withoutUndeliveredTouch(run: FlowRun, undelivered: ReadonlySet<string>): { run: FlowRun; undeliveredAt: number | null } {
  const touch = run.touch;
  if (!touch || !undelivered.has(touch.answerId)) return { run, undeliveredAt: null };
  const { touch: _touch, ...rest } = run;
  return {
    run: { ...withoutOwnStep(rest), lastAgentAt: touch.lastAgentAt, nudgeStep: touch.nudgeStep, ...(touch.nudgeStepOwn && { nudgeStepOwn: true }), agentAnswers: touch.agentAnswers },
    undeliveredAt: touch.at,
  };
}

/** Судья не подтвердил заявку агента: тот же выход можно заявить снова после нового сообщения человека. */
export function noteRejectedClaim(run: FlowRun, exitId: string): FlowRun {
  return { ...run, lastRejected: { exitId, atHumanMessages: run.humanMessages } };
}

/** Можно ли заявить выход: его не отклоняли с последнего сообщения человека. */
export function claimAllowed(run: FlowRun, exitId: string): boolean {
  return !(run.lastRejected?.exitId === exitId && run.lastRejected.atHumanMessages === run.humanMessages);
}

/** Агент спросил о человеке между делом: следующий такой вопрос — по темпу сценария. */
export function noteSideQuestion(run: FlowRun): FlowRun {
  return { ...run, sideQuestionAt: run.humanMessages };
}

/** Место без пометки «шаг насчитан своим рядом ноды». */
export function withoutOwnStep<R extends FlowRun>(run: R): R {
  const { nudgeStepOwn: _own, ...rest } = run;
  return rest as R;
}

/** Шаг ряда касаний после хода «пишет первым»: `own` — его насчитал свой ряд ноды на N дней. */
export function withNudgeStep<R extends FlowRun>(run: R, step: number, own: boolean): R {
  return { ...withoutOwnStep(run), nudgeStep: step, ...(own && { nudgeStepOwn: true }) };
}
