import type { AgentFlow } from "../format/flow-format";
import type { FlowFirstReason } from "../engine/nudges";
import type { FlowRun } from "../engine/flow-run";
import { stateById } from "../engine/flow-graph";
import type { FlowNotice } from "./flow-types";
import { describeCondition, exitById } from "./flow-events";
import { FLOW_TIMER_NOTICE } from "./prepare-turn";

// Один ход «пишет первым» на все причины одного срока (FR-304). Строки постоянные: служебное сообщение идёт в хвост
// хода, постоянная инструкция не меняется (кэш модели).

const REASON_LINES = {
  morning: "Начался новый день сценария: уместно доброе утро.",
  silence: (step: number) => `Человек молчит после твоего сообщения (касание ${step}).`,
  daily: (at: string) => `Касание по расписанию, ${at}.`,
  nightMessages: (count: number) => `Человек накопил сообщения без ответа (${count}): ответь на них.`,
} as const;

const TASK =
  "Ты пишешь человеку первым. Напиши одно короткое сообщение: новое и полезное для человека по теме разговора, без повтора уже сказанного и без упрёков за молчание.";

/** Строка переходов: «Сработало: тишина 3 ч» — как в 0.48. */
const transitionLine = (flow: AgentFlow, exitId: string) => {
  const exit = exitById(flow, exitId);
  return `Сработало: ${exit ? describeCondition(flow, exit.when) : exitId}`;
};

function reasonLine(reason: FlowFirstReason): string | null {
  switch (reason.kind) {
    case "morning":
      return REASON_LINES.morning;
    case "silence":
      return REASON_LINES.silence(reason.step);
    case "daily":
      return REASON_LINES.daily(reason.at);
    case "night_messages":
      return REASON_LINES.nightMessages(reason.count);
    default:
      return null;
  }
}

/** Сколько человек молчал к ходу «пишет первым»: от его последнего сообщения по часам чата; не писал — `undefined`. */
export function silentMsOf(run: Pick<FlowRun, "lastHumanAt">, at: number): number | undefined {
  return run.lastHumanAt === null ? undefined : Math.max(0, at - run.lastHumanAt);
}

/**
 * Служебное сообщение хода «пишет первым». Только переход ноды — прежнее «Сработало: …» (как в 0.48); есть другие
 * причины — их список и задача «новое и полезное». `data.exitId` — переход, который применит ход; `data.nudgeStep` —
 * шаг ряда касаний после хода (после перехода и утреннего — 0, ряд заново); `data.nudgeStepOwn` — его насчитал свой ряд ноды на N дней (`ownNudge`).
 * Для строки на экране (право `appNotices`, `flowNoticeLines`): `data.silentMs` — сколько человек молчал, `data.exit` —
 * нода, куда ведёт переход, и условие срока. Модель их не видит: текст для неё — `title`.
 */
export function firstReasonsNotice(
  flow: AgentFlow,
  reasons: readonly FlowFirstReason[],
  exitId: string | null,
  ownNudge = false,
  silentMs?: number,
): FlowNotice {
  const silence = reasons.find((reason) => reason.kind === "silence");
  const moved = exitId !== null && reasons.some((reason) => reason.kind === "transition");
  // Утреннее — новая точка отсчёта: ряд тишины после него с первого шага, каждый день заново.
  const morning = reasons.some((reason) => reason.kind === "morning");
  const nudgeStep = moved || morning ? 0 : silence?.kind === "silence" ? silence.step : undefined;
  const own = ownNudge && silence !== undefined && !moved && !morning;
  const exit = moved ? exitOnScreen(flow, exitId, reasons) : undefined;
  const data = {
    ...(moved && { exitId }),
    reasons: [...reasons],
    ...(nudgeStep !== undefined && { nudgeStep }),
    ...(own && { nudgeStepOwn: true }),
    ...(silentMs !== undefined && { silentMs }),
    ...(exit && { exit }),
  };
  const others = reasons.flatMap((reason) => reasonLine(reason) ?? []);
  if (others.length === 0 && moved) return { kind: "app", name: FLOW_TIMER_NOTICE, title: transitionLine(flow, exitId), data };
  const lines = [...(moved ? [`${transitionLine(flow, exitId)}.`] : []), ...others, TASK];
  return { kind: "app", name: FLOW_TIMER_NOTICE, title: lines.join("\n"), data };
}

/** Переход для строки на экране: название ноды, куда он ведёт, и условие срока. */
function exitOnScreen(flow: AgentFlow, exitId: string, reasons: readonly FlowFirstReason[]) {
  const to = reasons.find((reason) => reason.kind === "transition");
  const state = to?.kind === "transition" ? stateById(flow, to.stateId) : undefined;
  const when = exitById(flow, exitId)?.when;
  if (!state && !when) return undefined;
  return { ...(state && { stateTitle: state.title }), ...(when && { when }) };
}
