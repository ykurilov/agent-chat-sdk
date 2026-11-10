import {
  DEFAULT_LATE_START_HOURS,
  type AgentFlow,
  type FlowAfterEnd,
  type FlowCondition,
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

/**
 * Включение «Дней и времени» действующих касаний не меняет. Выключение сохраняет касания «Дней и времени» касаниями
 * сценария: доска показывает их и без дней, и они не должны пропасть или уступить место скрытым.
 */
export function setScheduleOn(flow: AgentFlow, on: boolean): AgentFlow {
  if (on) return flow.schedule ? flow : { ...flow, schedule: { ...DEFAULT_SCHEDULE } };
  const off = withOptional(flow, "schedule", undefined);
  return flow.schedule?.nudges ? { ...off, nudges: flow.schedule.nudges } : off;
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

export type DurationUnit = "h" | "d" | "program_day";

/**
 * Продолжительность ноды: выход «длится N дней сценария» (`state_days`), «до дня N программы» (`program_day`, `amount` —
 * номер дня) или «N часов в этом состоянии».
 */
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
  if (when.from === "program_day") return { exitId: exit.id, amount: when.day, unit: "program_day", to: exit.to };
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

/** «Длится»: дни — `state_days`, день программы — `program_day`, часы — `in_state`. Правится тот же выход; `null` — выход убирается. */
export function setDuration(flow: AgentFlow, stateId: string, value: { amount: number; unit: DurationUnit } | null): AgentFlow {
  const state = flow.states.find((candidate) => candidate.id === stateId);
  if (!state) return flow;
  const current = durationOf(state);
  if (value === null) {
    if (!current) return flow;
    return { ...flow, states: flow.states.map((candidate) => (candidate.id === stateId ? { ...candidate, exits: candidate.exits.filter((exit) => exit.id !== current.exitId) } : candidate)) };
  }
  const amount = Math.max(1, Math.round(value.amount) || 1);
  const when: FlowCondition =
    value.unit === "d"
      ? { type: "timer", from: "state_days", days: amount }
      : value.unit === "program_day"
        ? { type: "timer", from: "program_day", day: amount }
        : { type: "timer", from: "in_state", amount, unit: "h" };
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
      return { ...state, nudges: structuredClone(commonNudges(flow) ?? DEFAULT_NUDGES) };
    }),
  };
}

/** Своё расписание касаний ноды: пустые части убираются, сроки в днях остаются. */
export function updateStateNudges(flow: AgentFlow, stateId: string, nudges: FlowNudges): AgentFlow {
  return {
    ...flow,
    states: flow.states.map((state) => {
      if (state.id !== stateId) return state;
      const own = state.nudges && state.nudges !== "off" ? state.nudges : undefined;
      return {
        ...state,
        nudges: {
          ...cleanNudges(nudges),
          ...(own?.days !== undefined && { days: own.days }),
          ...(own?.untilProgramDay !== undefined && { untilProgramDay: own.untilProgramDay }),
        },
      };
    }),
  };
}

/** Сколько дней действуют свои касания ноды, считая день входа; `null` — всё время в ноде. */
export function setStateNudgesDays(flow: AgentFlow, stateId: string, days: number | null): AgentFlow {
  return {
    ...flow,
    states: flow.states.map((state) => {
      if (state.id !== stateId || !state.nudges || state.nudges === "off") return state;
      const { days: _days, ...rest } = state.nudges;
      return { ...state, nudges: days === null ? rest : { ...rest, days: Math.max(1, Math.round(days) || 1) } };
    }),
  };
}

/** Срок своих касаний ноды в днях; всё время в ноде или касания не свои — `null`. */
export function stateNudgesDays(state: FlowState): number | null {
  return state.nudges && state.nudges !== "off" ? (state.nudges.days ?? null) : null;
}

/** Свои касания ноды действуют до этого дня программы включительно; `null` — без такого предела. С 0.67. */
export function setStateNudgesUntilProgramDay(flow: AgentFlow, stateId: string, day: number | null): AgentFlow {
  return {
    ...flow,
    states: flow.states.map((state) => {
      if (state.id !== stateId || !state.nudges || state.nudges === "off") return state;
      const { untilProgramDay: _until, ...rest } = state.nudges;
      return { ...state, nudges: day === null ? rest : { ...rest, untilProgramDay: Math.max(1, Math.round(day) || 1) } };
    }),
  };
}

/** До какого дня программы действуют свои касания ноды; предела нет или касания не свои — `null`. */
export function stateNudgesUntilProgramDay(state: FlowState): number | null {
  return state.nudges && state.nudges !== "off" ? (state.nudges.untilProgramDay ?? null) : null;
}

/** Потолок «пишет первым» по дням программы текстом: `[3, 2]` → «3, 2». */
export function capsByDayText(caps: number[] | undefined): string {
  return caps?.join(", ") ?? "";
}

/** «3, 2» → `[3, 2]`; пусто — `undefined` (потолок без дней); не числа — `null`. */
export function parseCapsByDay(text: string): number[] | undefined | null {
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const caps = parts.map(Number);
  return caps.every((cap) => Number.isInteger(cap) && cap >= 0) ? caps : null;
}

/** Общие касания, которые действуют у нод без своих: `schedule.nudges`, иначе касания сценария. Нет — `null`. */
export function commonNudges(flow: AgentFlow): FlowNudges | null {
  return flow.schedule?.nudges ?? flow.nudges ?? null;
}

/**
 * Правка общих касаний там, где они действуют: в «Днях и времени», если касания заданы там, иначе у сценария (дни не
 * включаются). Перекрытые касания сценария при этом убираются. `null` — касаний нет нигде: агент не пишет первым.
 */
export function updateCommonNudges(flow: AgentFlow, nudges: FlowNudges | null): AgentFlow {
  const withoutRoot = withOptional(flow, "nudges", undefined);
  if (nudges === null) return flow.schedule?.nudges ? updateScheduleNudges(withoutRoot, null) : withoutRoot;
  if (flow.schedule?.nudges) return updateScheduleNudges(withoutRoot, nudges);
  return { ...flow, nudges: cleanNudges(nudges) };
}

/** Касания по умолчанию в «Днях и времени»; `null` — без них. Общие касания доска правит `updateCommonNudges`. */
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

/** Касания одной строкой: «30 мин · каждый день в 19:00 · молчит 3 дн. — разговор окончен». */
export function nudgesSummary(nudges: FlowNudges, labels: FlowEditorLabels): string {
  const parts = nudges.afterSilence.map((step) => durationText(step, labels));
  if (nudges.dailyAt?.length) parts.push(labels.nudges.summaryDaily(nudges.dailyAt.join(", ")));
  if (nudges.giveUpAfter) parts.push(labels.nudges.summaryGiveUp(durationText(nudges.giveUpAfter, labels)));
  return parts.join(" · ");
}

/** Подпись «Длится» и касаний на карточке ноды: «1 день · касания 15 мин · 1 ч · 4 ч». Ничего своего — пусто. */
export function stateTimingText(flow: AgentFlow, state: FlowState, labels: FlowEditorLabels): string {
  const parts: string[] = [];
  const duration = durationOf(state);
  if (duration) {
    parts.push(duration.unit === "d" ? labels.days(duration.amount) : duration.unit === "program_day" ? labels.programDay(duration.amount) : `${duration.amount} ${labels.units.h}`);
  }
  if (state.nudges === "off") parts.push(labels.board.noNudges);
  else if (state.nudges) {
    const steps = state.nudges.afterSilence.map((step) => durationText(step, labels));
    const daily = state.nudges.dailyAt ?? [];
    const days = state.nudges.days === undefined ? "" : ` ${labels.board.nudgesDays(state.nudges.days)}`;
    const until = state.nudges.untilProgramDay === undefined ? "" : ` ${labels.board.nudgesUntilProgramDay(state.nudges.untilProgramDay)}`;
    if (steps.length + daily.length > 0) parts.push(`${labels.board.nudges} ${[...steps, ...daily].join(" · ")}${days}${until}`);
  }
  return parts.join(" · ");
}
