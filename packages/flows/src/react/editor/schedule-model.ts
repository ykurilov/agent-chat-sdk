import {
  DEFAULT_LATE_START_HOURS,
  type AgentFlow,
  type FlowAfterEnd,
  type FlowDuration,
  type FlowExit,
  type FlowNudges,
  type FlowSchedule,
  type FlowState,
} from "../../format/flow-format";
import type { FlowEditorLabels } from "../../labels/editor";
import { addExit, updateExit } from "./editor-model";

// Правки «Дней и времени», продолжительности и касаний ноды: чистые функции, каждая возвращает новый `AgentFlow`.

/** «Дни и время» при включении: день с 9:00, порог позднего старта по умолчанию, без прощания. */
export const DEFAULT_SCHEDULE: FlowSchedule = { dayStart: "09:00", lateStartHours: DEFAULT_LATE_START_HOURS, farewellOnDeadline: false };

/** Свои касания ноды без общего образца: 15 мин · 1 ч · 4 ч тишины. */
export const DEFAULT_NUDGES: FlowNudges = {
  afterSilence: [
    { amount: 15, unit: "min" },
    { amount: 1, unit: "h" },
    { amount: 4, unit: "h" },
  ],
};

/** Без ключей со значением `undefined`; пустой объект — `undefined`. */
function compact<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined && item !== "");
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T);
}

function withOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): T {
  const { [key]: _old, ...rest } = target;
  return (value === undefined ? rest : { ...rest, [key]: value }) as T;
}

export function setScheduleOn(flow: AgentFlow, on: boolean): AgentFlow {
  if (on) return flow.schedule ? flow : { ...flow, schedule: { ...DEFAULT_SCHEDULE } };
  return withOptional(flow, "schedule", undefined);
}

export type SchedulePatch = { [K in keyof FlowSchedule]?: FlowSchedule[K] | undefined };

/** Правка «Дней и времени»: `undefined` и пустая строка убирают поле, пустые вложенные разделы — целиком. */
export function updateSchedule(flow: AgentFlow, patch: SchedulePatch): AgentFlow {
  let schedule: FlowSchedule = flow.schedule ?? { ...DEFAULT_SCHEDULE };
  for (const [key, raw] of Object.entries(patch) as Array<[keyof FlowSchedule, unknown]>) {
    const value = raw !== null && typeof raw === "object" && !Array.isArray(raw) && key !== "nudges" ? compact(raw) : raw === "" ? undefined : raw;
    schedule = withOptional(schedule, key, value as never);
  }
  return { ...flow, schedule };
}

export function setAfterEnd(flow: AgentFlow, mode: FlowAfterEnd): AgentFlow {
  return { ...flow, afterEnd: mode };
}

// ---------- «Длится» ----------

export type DurationUnit = "h" | "d";

/** Продолжительность ноды: выход «длится N дней сценария» (`state_days`) или «N часов в этом состоянии». */
export interface StateDuration {
  exitId: string;
  amount: number;
  unit: DurationUnit;
  to: string | null;
}

function durationExit(exit: FlowExit): StateDuration | null {
  const { when } = exit;
  if (when.type !== "timer") return null;
  if (when.from === "state_days") return { exitId: exit.id, amount: when.days, unit: "d", to: exit.to };
  if (when.from === "in_state" && when.unit === "h") return { exitId: exit.id, amount: when.amount, unit: "h", to: exit.to };
  return null;
}

/** Первый выход-продолжительность ноды; минуты «в этом состоянии» — обычный таймер, не «Длится». */
export function durationOf(state: FlowState): StateDuration | null {
  for (const exit of state.exits) {
    const found = durationExit(exit);
    if (found) return found;
  }
  return null;
}

/** «Длится»: дни — `state_days`, часы — `in_state`. Правится тот же выход; `null` — выход убирается. */
export function setDuration(flow: AgentFlow, stateId: string, value: { amount: number; unit: DurationUnit } | null): AgentFlow {
  const state = flow.states.find((candidate) => candidate.id === stateId);
  if (!state) return flow;
  const current = durationOf(state);
  if (value === null) {
    if (!current) return flow;
    return { ...flow, states: flow.states.map((candidate) => (candidate.id === stateId ? { ...candidate, exits: candidate.exits.filter((exit) => exit.id !== current.exitId) } : candidate)) };
  }
  const amount = Math.max(1, Math.round(value.amount) || 1);
  const when = value.unit === "d" ? ({ type: "timer", from: "state_days", days: amount } as const) : ({ type: "timer", from: "in_state", amount, unit: "h" } as const);
  if (current) return updateExit(flow, stateId, current.exitId, { when, to: current.to });
  const made = addExit(flow, stateId, "timer");
  return updateExit(made.flow, stateId, made.exitId, { when, to: null });
}

// ---------- Касания ----------

export type NudgesMode = "inherit" | "own" | "off";

export function nudgesMode(state: FlowState): NudgesMode {
  if (state.nudges === "off") return "off";
  return state.nudges ? "own" : "inherit";
}

/** Касания ноды: как у сценария (поля нет), свои (образец — общие или 15 мин · 1 ч · 4 ч), выкл. */
export function setStateNudges(flow: AgentFlow, stateId: string, mode: NudgesMode): AgentFlow {
  return {
    ...flow,
    states: flow.states.map((state) => {
      if (state.id !== stateId || nudgesMode(state) === mode) return state;
      if (mode === "inherit") return withOptional(state, "nudges", undefined);
      if (mode === "off") return { ...state, nudges: "off" };
      return { ...state, nudges: structuredClone(flow.schedule?.nudges ?? DEFAULT_NUDGES) };
    }),
  };
}

/** Своё расписание касаний ноды: пустые части убираются. */
export function updateStateNudges(flow: AgentFlow, stateId: string, nudges: FlowNudges): AgentFlow {
  return { ...flow, states: flow.states.map((state) => (state.id === stateId ? { ...state, nudges: cleanNudges(nudges) } : state)) };
}

/** Касания по умолчанию в «Днях и времени»; `null` — без общих касаний. */
export function updateScheduleNudges(flow: AgentFlow, nudges: FlowNudges | null): AgentFlow {
  return updateSchedule(flow, { nudges: nudges === null ? undefined : cleanNudges(nudges) });
}

function cleanNudges(nudges: FlowNudges): FlowNudges {
  let clean: FlowNudges = { afterSilence: nudges.afterSilence };
  if (nudges.dailyAt?.length) clean = { ...clean, dailyAt: nudges.dailyAt };
  if (nudges.giveUpAfter) clean = { ...clean, giveUpAfter: nudges.giveUpAfter };
  return clean;
}

// ---------- Подписи ----------

/** «15 мин», «4 ч», «3 дн.». */
export function durationText(duration: FlowDuration, labels: FlowEditorLabels): string {
  return `${duration.amount} ${labels.units[duration.unit]}`;
}

/** Подпись «Длится» и касаний на карточке ноды: «1 день · касания 15 мин · 1 ч · 4 ч». Ничего своего — пусто. */
export function stateTimingText(flow: AgentFlow, state: FlowState, labels: FlowEditorLabels): string {
  const parts: string[] = [];
  const duration = durationOf(state);
  if (duration) parts.push(duration.unit === "d" ? labels.days(duration.amount) : `${duration.amount} ${labels.units.h}`);
  if (state.nudges === "off") parts.push(labels.board.noNudges);
  else if (state.nudges) {
    const steps = state.nudges.afterSilence.map((step) => durationText(step, labels));
    const daily = state.nudges.dailyAt ?? [];
    if (steps.length + daily.length > 0) parts.push(`${labels.board.nudges} ${[...steps, ...daily].join(" · ")}`);
  }
  return parts.join(" · ");
}
