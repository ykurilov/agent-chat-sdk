import { FLOW_OPS_BY_FIELD_TYPE, type AgentFlow, type DataCondition, type FlowExit, type FlowField } from "../../format/flow-format";
import type { FlowRun } from "../../engine/flow-run";
import { nextTransition, type FlowEvent } from "../../engine/next-transition";
import { activeExits, fieldById, stateById } from "../../engine/flow-graph";
import { applyTransition, noteAgentAnswer, noteHumanMessage, noteSideQuestion, startRun } from "../../engine/run-updates";
import { sideQuestion } from "../../engine/side-questions";
import { timerDueAt } from "../../engine/timers";

// Прогон в редакторе: автор выбирает, что произошло, а решает движок — тот же `nextTransition`, что в рабочем чате.
// Часы прогона свои: каждый шаг — минута разговора, таймер перематывает к своему сроку.

const STEP_MS = 60_000;

/** Шаг пути прогона: куда пришли и по какому условию; `nothing` — «ничего из этого», агент остался. */
export interface SimulationStep {
  stateId: string;
  exitId: string | null;
  nothing: boolean;
}

export interface Simulation {
  run: FlowRun;
  /** Карточка клиента в прогоне: id поля → значение и когда записано. */
  card: Record<string, { value: unknown; updatedAt: number }>;
  now: number;
  timeZone: string;
  steps: SimulationStep[];
  /** Прогон до последнего шага — для «шаг назад». */
  previous: Simulation | null;
}

/** Выбор «что произошло»: условие и куда приведёт движок (`null` — не сработает). */
export interface SimulationChoice {
  exitId: string;
  own: boolean;
  target: string | null;
}

export function startSimulation(flow: AgentFlow, options: { now: number; timeZone: string }): Simulation {
  // Агент начинает разговор первым: от этого считается тишина человека.
  const run = noteAgentAnswer(startRun(flow, options.now), options.now);
  return { run, card: {}, now: options.now, timeZone: options.timeZone, steps: [{ stateId: run.state, exitId: null, nothing: false }], previous: null };
}

export function simulationChoices(flow: AgentFlow, sim: Simulation): SimulationChoice[] {
  const state = stateById(flow, sim.run.state);
  if (!state) return [];
  return activeExits(flow, state).map(({ exit, own }) => {
    const after = chooseExit(flow, sim, exit.id);
    return { exitId: exit.id, own, target: after.steps.length > sim.steps.length ? after.run.state : null };
  });
}

function findExit(flow: AgentFlow, exitId: string): FlowExit | undefined {
  return [...flow.states.flatMap((state) => state.exits), ...flow.anyState.exits].find((exit) => exit.id === exitId);
}

/** Значение, при котором условие по данным выполнено. Уже подходящее не трогаем. */
function fittingValue(condition: DataCondition, field: FlowField): unknown {
  const expected = condition.value;
  switch (condition.op) {
    case "eq":
    case "contains":
      return expected;
    case "gt":
      return typeof expected === "number" ? expected + 1 : expected;
    case "lt":
      return typeof expected === "number" ? expected - 1 : expected;
    case "filled":
      if (field.type === "number") return 1;
      return field.type === "choice" && field.options.length > 0 ? field.options[0] : "✓";
  }
}

function writeValue(flow: AgentFlow, sim: Simulation, fieldId: string, value: unknown): Simulation {
  const found = fieldById(flow, fieldId);
  if (!found) return sim;
  if (found.place === "notes") return { ...sim, run: { ...sim.run, notes: { ...sim.run.notes, [fieldId]: value } } };
  return { ...sim, card: { ...sim.card, [fieldId]: { value, updatedAt: sim.now } } };
}

function cardValues(sim: Simulation): Record<string, unknown> {
  return Object.fromEntries(Object.entries(sim.card).map(([id, entry]) => [id, entry.value]));
}

/**
 * Шаг: человек написал (кроме таймера), движок ищет переход по событию, агент ответил. Если между делом был вопрос о
 * человеке — он задан, следующий по темпу сценария.
 */
function step(flow: AgentFlow, before: Simulation, prepare: (sim: Simulation) => { sim: Simulation; event: FlowEvent | null; human: boolean }): Simulation {
  const asked = sideQuestion(flow, before.run, { card: before.card, now: before.now });
  const prepared = prepare({ ...before, now: before.now + STEP_MS });
  const sim = prepared.sim;
  let run = prepared.human ? noteHumanMessage(sim.run, sim.now) : sim.run;
  const transition = prepared.event ? nextTransition(flow, run, prepared.event, sim.now) : null;
  const steps = [...sim.steps];
  if (transition) {
    run = applyTransition(flow, run, transition);
    steps.push({ stateId: transition.to, exitId: transition.exitId, nothing: false });
  } else if (prepared.event === null) {
    steps.push({ stateId: run.state, exitId: null, nothing: true });
  } else {
    // Условие не сработало (нет цели, «назад» некуда): прогон не меняется.
    return before;
  }
  run = noteAgentAnswer(run, sim.now);
  if (asked && asked.reason !== "learn") run = noteSideQuestion(run);
  return { ...sim, run, steps, previous: before };
}

/** Автор выбрал условие: собираем событие, на которое оно срабатывает, и отдаём движку. */
export function chooseExit(flow: AgentFlow, sim: Simulation, exitId: string): Simulation {
  const exit = findExit(flow, exitId);
  if (!exit) return sim;
  const when = exit.when;
  return step(flow, sim, (current) => {
    switch (when.type) {
      case "judge":
        return { sim: current, human: true, event: { type: "verdict", exitId, probability: 1, decidedBy: "judge" } };
      case "event":
        return {
          sim: current,
          human: when.event === "message",
          event: { type: "event", event: when.event, ...(when.name === undefined ? {} : { name: when.name }) },
        };
      case "timer": {
        const due = timerDueAt(when, current.run, current.timeZone);
        // Часы прогона идут только вперёд: срок в прошлом — срабатывает сейчас.
        const now = due === null ? current.now : Math.max(current.now - STEP_MS, due);
        return { sim: { ...current, now }, human: false, event: { type: "timer", exitId, timeZone: current.timeZone } };
      }
      case "data": {
        const found = fieldById(flow, when.field);
        if (!found || !FLOW_OPS_BY_FIELD_TYPE[found.field.type].includes(when.op)) {
          return { sim: current, human: true, event: { type: "data", field: when.field, card: cardValues(current) } };
        }
        const filled = writeValue(flow, current, when.field, fittingValue(when, found.field));
        return { sim: filled, human: true, event: { type: "data", field: when.field, card: cardValues(filled) } };
      }
    }
  });
}

/** «Ничего из этого»: человек написал, агент ответил, остались в том же состоянии. */
export function chooseNothing(flow: AgentFlow, sim: Simulation): Simulation {
  return step(flow, sim, (current) => ({ sim: current, human: true, event: null }));
}

/**
 * Автор вписал, что агент знает о человеке. Число — для числовых полей; пусто — поле забыто. Если от этого сработало
 * условие по данным — переход, как в рабочем чате.
 */
export function setKnownValue(flow: AgentFlow, sim: Simulation, fieldId: string, text: string): Simulation {
  const found = fieldById(flow, fieldId);
  if (!found) return sim;
  const trimmed = text.trim();
  const value = trimmed === "" ? undefined : found.field.type === "number" && Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed;
  let written = writeValue(flow, sim, fieldId, value);
  if (value === undefined) {
    written =
      found.place === "notes"
        ? { ...written, run: { ...written.run, notes: withoutKey(written.run.notes, fieldId) } }
        : { ...written, card: withoutKey(written.card, fieldId) };
    return written;
  }
  const transition = nextTransition(flow, written.run, { type: "data", field: fieldId, card: cardValues(written) }, written.now);
  if (!transition) return written;
  return {
    ...written,
    run: noteAgentAnswer(applyTransition(flow, written.run, transition), written.now),
    steps: [...written.steps, { stateId: transition.to, exitId: transition.exitId, nothing: false }],
    previous: sim,
  };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/** id поля, о котором агент спросит сейчас; `null` — ни о чём. */
export function nextQuestionField(flow: AgentFlow, sim: Simulation): string | null {
  return sideQuestion(flow, sim.run, { card: sim.card, now: sim.now })?.fieldId ?? null;
}

export function stepBack(sim: Simulation): Simulation {
  return sim.previous ?? sim;
}
