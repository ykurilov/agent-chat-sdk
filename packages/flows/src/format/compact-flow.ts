import { DEFAULT_SIDE_QUESTION_EVERY_MESSAGES } from "./flow-schema";
import {
  DEFAULT_LATE_START_HOURS,
  DEFAULT_SIDE_TASK_MAX_ATTEMPTS,
  type AgentFlow,
  type FlowExit,
  type FlowField,
  type FlowSchedule,
  type FlowSideTask,
  type FlowState,
} from "./flow-format";

type Json = Record<string, unknown>;

/**
 * JSON сценария без значений по умолчанию — так его хранят и показывают в окне JSON.
 * `parseFlow(compactFlow(flow))` возвращает тот же сценарий.
 */
export function compactFlow(flow: AgentFlow): Json {
  return withoutEmpty({
    format: flow.format,
    version: flow.version,
    id: flow.id,
    name: flow.name,
    start: flow.start,
    common: flow.common,
    pace:
      flow.pace.sideQuestionEveryMessages === DEFAULT_SIDE_QUESTION_EVERY_MESSAGES
        ? undefined
        : { sideQuestionEveryMessages: flow.pace.sideQuestionEveryMessages },
    clientCard: flow.clientCard.map(compactField),
    chatNotes: flow.chatNotes.map(compactField),
    tools: flow.tools,
    anyState: flow.anyState.except.length || flow.anyState.exits.length
      ? withoutEmpty({ except: flow.anyState.except, exits: flow.anyState.exits.map(compactExit) })
      : undefined,
    states: flow.states.map(compactState),
    layout: Object.keys(flow.layout).length ? flow.layout : undefined,
    schedule: flow.schedule && compactSchedule(flow.schedule),
    nudges: flow.nudges,
    sideTasks: flow.sideTasks?.map(compactSideTask),
    afterEnd: flow.afterEnd,
  }, ["states"]);
}

function compactSchedule(schedule: FlowSchedule): Json {
  return withoutEmpty({
    ...schedule,
    lateStartHours: schedule.lateStartHours === DEFAULT_LATE_START_HOURS ? undefined : schedule.lateStartHours,
    farewellOnDeadline: schedule.farewellOnDeadline || undefined,
  });
}

function compactSideTask(task: FlowSideTask): Json {
  return withoutEmpty({
    ...task,
    maxAttempts: task.maxAttempts === DEFAULT_SIDE_TASK_MAX_ATTEMPTS ? undefined : task.maxAttempts,
    perConversation: task.perConversation || undefined,
  });
}

function compactField(field: FlowField): Json {
  return withoutEmpty({ ...field, type: field.type === "text" ? undefined : field.type });
}

function compactState(state: FlowState): Json {
  return withoutEmpty({
    ...state,
    kind: state.kind === "state" ? undefined : state.kind,
    noSideQuestions: state.noSideQuestions || undefined,
    exits: state.exits.map(compactExit),
  });
}

function compactExit(exit: FlowExit): Json {
  const when = exit.when.type === "data" && exit.when.op === "filled" ? { ...exit.when, op: undefined } : exit.when;
  return withoutEmpty({ id: exit.id, when: withoutEmpty(when as Json), to: exit.to });
}

/** Убирает `undefined`, `null`, пустые строки и пустые списки — кроме перечисленных ключей. */
function withoutEmpty(object: Json, keep: readonly string[] = []): Json {
  return Object.fromEntries(
    Object.entries(object).filter(([key, value]) => {
      if (keep.includes(key)) return true;
      if (value === undefined || value === null || value === "") return false;
      return !(Array.isArray(value) && value.length === 0);
    }),
  );
}
