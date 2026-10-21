import {
  FLOW_OPS_BY_FIELD_TYPE,
  RETURN_TARGET,
  type AgentFlow,
  type FlowCatalog,
  type FlowExit,
  type FlowIssue,
  type FlowNudges,
  type FlowState,
} from "../format/flow-format";
import { appIssues, type FlowAppChecks } from "./app-checks";
import { catalogEventNames } from "../format/catalog-events";
import { commonApplies, fieldById, isFinal, sameText, stateById } from "../engine/flow-graph";
import { parseClock } from "../engine/zoned-time";

// Одна проверка для редактора и сервера (FR-002): сервер не запускает сценарий с ошибками, редактор ведёт к месту ошибки.
// Порядок находок: повторы id, старт, инструменты сценария, состояния по порядку, общие переходы, «Дни и время»,
// попутные задачи, достижимость, свои проверки приложения.

type Place = FlowIssue["place"];

class Issues {
  readonly list: FlowIssue[] = [];
  error(code: string, message: string, place: Place = {}) {
    this.list.push({ level: "error", code, message, place });
  }
  warning(code: string, message: string, place: Place = {}) {
    this.list.push({ level: "warning", code, message, place });
  }
}

const quote = (text: string) => `«${text}»`;
const stateName = (state: FlowState) => quote(state.title.trim() || state.id);

function checkDuplicates(flow: AgentFlow, issues: Issues) {
  const states = new Set<string>();
  for (const state of flow.states) {
    if (states.has(state.id)) issues.error("duplicate_state", `Два состояния с id ${quote(state.id)}`, { stateId: state.id });
    states.add(state.id);
  }
  const exits = new Set<string>();
  const exitsOf: Array<{ stateId?: string; exits: FlowExit[] }> = [
    ...flow.states.map((state) => ({ stateId: state.id, exits: state.exits })),
    { exits: flow.anyState.exits },
  ];
  for (const { stateId, exits: list } of exitsOf) {
    for (const exit of list) {
      if (exits.has(exit.id)) {
        issues.error("duplicate_exit", `Два условия с id ${quote(exit.id)}: история переходов их не различит`, {
          ...(stateId === undefined ? {} : { stateId }),
          exitId: exit.id,
        });
      }
      exits.add(exit.id);
    }
  }
  const fields = new Set<string>();
  for (const field of [...flow.clientCard, ...flow.chatNotes]) {
    if (fields.has(field.id)) issues.error("duplicate_field", `Два поля с id ${quote(field.id)} в карточке и заметках`, { fieldId: field.id });
    fields.add(field.id);
  }
}

function eventKnown(exit: FlowExit, catalog: FlowCatalog): boolean {
  if (exit.when.type !== "event" || exit.when.name === undefined) return true;
  const { event, name } = exit.when;
  if (event === "tool") return catalog.tools.includes(name);
  if (event === "button") return catalog.widgets.includes(name) || catalogEventNames(catalog).includes(name);
  if (event === "app") return catalogEventNames(catalog).includes(name);
  return true;
}

function checkExit(flow: AgentFlow, catalog: FlowCatalog, issues: Issues, exit: FlowExit, index: number, state?: FlowState) {
  const where = state ? stateName(state) : "Общие переходы";
  const what = `${where}: условие №${index + 1}`;
  const place: Place = state ? { stateId: state.id, exitId: exit.id } : { exitId: exit.id };

  if (exit.to === null) issues.error("exit_without_target", `${what} никуда не ведёт`, place);
  else if (exit.to === RETURN_TARGET) {
    if (!state) issues.error("return_from_any_state", `${what}: «назад» из общих переходов — непонятно, куда возвращаться`, place);
  } else if (!stateById(flow, exit.to)) issues.error("unknown_target", `${what} ведёт в состояние ${quote(exit.to)}, которого нет`, place);

  const when = exit.when;
  if (when.type === "judge" && when.text.trim() === "") {
    issues.error("empty_judge", `${what} не написано: агенту и судье нечего проверять`, place);
  }
  if (when.type === "data") {
    const found = fieldById(flow, when.field);
    const fieldPlace = { ...place, fieldId: when.field };
    if (!found) {
      issues.error("unknown_field", `${what}: поля ${quote(when.field)} нет ни в карточке клиента, ни в заметках чата`, fieldPlace);
    } else if (!FLOW_OPS_BY_FIELD_TYPE[found.field.type].includes(when.op)) {
      issues.error("op_not_for_type", `${what}: поле ${quote(found.field.name)} так не сравнивается`, fieldPlace);
    } else if (found.field.type === "number" && when.op !== "filled" && typeof when.value !== "number") {
      issues.error("value_not_number", `${what}: поле ${quote(found.field.name)} — число, сравнивать его нужно с числом`, fieldPlace);
    } else if (found.field.type === "boolean" && when.op !== "filled" && typeof when.value !== "boolean") {
      issues.error("value_not_boolean", `${what}: поле ${quote(found.field.name)} — «да/нет», сравнивать его нужно с «да» или «нет»`, fieldPlace);
    } else if (
      found.field.type === "choice" &&
      when.op === "eq" &&
      found.field.options.length > 0 &&
      !found.field.options.some((option) => sameText(option, String(when.value)))
    ) {
      issues.error("value_not_in_options", `${what}: у поля ${quote(found.field.name)} нет варианта ${quote(String(when.value))}`, fieldPlace);
    }
  }
  if (when.type === "timer" && when.from === "state_days") {
    if (!flow.schedule) {
      issues.error("state_days_without_day_start", `${what}: «длится ${when.days} дн.» — у сценария не задано начало дня («Дни и время»)`, place);
    }
    if (when.days < 1) issues.error("state_days_below_one", `${what}: нода должна длиться хотя бы один день`, place);
  }
  if (when.type === "timer" && when.from === "program_day") {
    if (!Number.isInteger(when.day) || when.day < 1) {
      issues.error("program_day_invalid", `${what}: день программы — целое число с 1`, place);
    } else if (flow.schedule?.lengthDays !== undefined && when.day > flow.schedule.lengthDays) {
      issues.error("program_day_after_end", `${what}: дня ${when.day} нет — программа длится ${flow.schedule.lengthDays} дн.`, place);
    }
    if (!flow.schedule) issues.warning("program_day_without_schedule", `${what}: «с дня ${when.day}» не сработает — у сценария нет «Дней и времени»`, place);
  }
  if (when.type === "event" && when.event !== "message") {
    if (when.name === undefined || when.name.trim() === "") {
      issues.error("event_without_name", `${what}: не выбрано, какое событие ждать`, place);
    } else if (!eventKnown(exit, catalog)) {
      issues.error("unknown_event", `${what}: приложение не объявило ${quote(when.name)}`, place);
    }
  }
}

function checkState(flow: AgentFlow, catalog: FlowCatalog, issues: Issues, state: FlowState) {
  for (const tool of state.tools) {
    if (!flow.tools.includes(tool)) {
      issues.error("tool_not_in_flow", `${stateName(state)}: инструмента ${quote(tool)} нет в списке инструментов сценария`, { stateId: state.id });
    } else if (!catalog.tools.includes(tool)) {
      issues.error("unknown_tool", `${stateName(state)}: инструмента ${quote(tool)} нет у приложения`, { stateId: state.id });
    }
  }
  for (const fieldId of state.learn) {
    if (!fieldById(flow, fieldId)) {
      issues.error("unknown_learn_field", `${stateName(state)}: «узнать здесь» — поля ${quote(fieldId)} нет`, { stateId: state.id, fieldId });
    }
  }
  state.exits.forEach((exit, index) => checkExit(flow, catalog, issues, exit, index, state));
  if (state.nudges && state.nudges !== "off" && nudgesEmpty(state.nudges)) {
    issues.warning("empty_nudges", `${stateName(state)}: в касаниях нет ни одного срока — агент не напишет первым`, { stateId: state.id });
  }
  const days = state.nudges && state.nudges !== "off" ? state.nudges.days : undefined;
  if (days !== undefined && (!Number.isInteger(days) || days < 1)) {
    issues.error("nudges_days_invalid", `${stateName(state)}: свои касания действуют целое число дней, с 1`, { stateId: state.id });
  }
  const untilDay = state.nudges && state.nudges !== "off" ? state.nudges.untilProgramDay : undefined;
  if (untilDay !== undefined && (!Number.isInteger(untilDay) || untilDay < 1)) {
    issues.error("nudges_until_day_invalid", `${stateName(state)}: свои касания «до дня программы» — целое число с 1`, { stateId: state.id });
  } else if (untilDay !== undefined && flow.schedule?.lengthDays !== undefined && untilDay > flow.schedule.lengthDays) {
    issues.warning("nudges_until_day_after_end", `${stateName(state)}: свои касания до дня ${untilDay}, а программа длится ${flow.schedule.lengthDays} дн. — они действуют всю программу`, {
      stateId: state.id,
    });
  }
}

const nudgesEmpty = (nudges: FlowNudges) => nudges.afterSilence.length === 0 && !nudges.dailyAt?.length;

function checkSchedule(flow: AgentFlow, issues: Issues) {
  const schedule = flow.schedule;
  if (!schedule) return;
  const dayStart = parseClock(schedule.dayStart);
  const nightFrom = schedule.nightFrom === undefined ? null : parseClock(schedule.nightFrom);
  if (dayStart !== null && nightFrom !== null && nightFrom <= dayStart) {
    issues.error("night_before_day_start", `«Дни и время»: ночь (${schedule.nightFrom}) начинается не позже начала дня (${schedule.dayStart})`);
  }
  if (schedule.deadlineState !== undefined && !stateById(flow, schedule.deadlineState)) {
    issues.error("unknown_deadline_state", `«Дни и время»: при «срок вышел» переход в состояние ${quote(schedule.deadlineState)}, которого нет`, {
      stateId: schedule.deadlineState,
    });
  }
  const frame = schedule.dayFrame;
  if (frame?.softFrom !== undefined && frame.hardAt !== undefined && frame.softFrom >= frame.hardAt) {
    issues.error("day_frame_soft_after_hard", `«Дни и время»: мягкая рамка (${frame.softFrom}) должна быть раньше жёсткой (${frame.hardAt})`);
  }
  const byDay = schedule.firstMessages?.maxPerDayByDay;
  if (byDay && schedule.lengthDays !== undefined && byDay.length > schedule.lengthDays) {
    issues.warning(
      "max_per_day_by_day_after_end",
      `«Дни и время»: потолок задан на ${byDay.length} дн., а программа длится ${schedule.lengthDays} дн. — лишние значения не действуют`,
    );
  }
  if (schedule.nudges && nudgesEmpty(schedule.nudges)) {
    issues.warning("empty_nudges", "«Дни и время»: в касаниях нет ни одного срока — агент не напишет первым");
  }
  if (schedule.nudges && flow.nudges) {
    issues.warning("nudges_shadowed", "Касания заданы и у сценария, и в «Днях и времени»: действуют касания «Дней и времени»");
  }
}

function checkFlowNudges(flow: AgentFlow, issues: Issues) {
  if (flow.nudges && nudgesEmpty(flow.nudges)) {
    issues.warning("empty_nudges", "Касания сценария: нет ни одного срока — агент не напишет первым");
  }
}

function checkSideTasks(flow: AgentFlow, issues: Issues) {
  const seen = new Set<string>();
  for (const task of flow.sideTasks ?? []) {
    if (seen.has(task.id)) issues.error("duplicate_side_task", `Две попутные задачи с id ${quote(task.id)}`, { sideTaskId: task.id });
    seen.add(task.id);
    if (task.field !== undefined && !fieldById(flow, task.field)) {
      issues.error("side_task_unknown_field", `Попутная задача ${quote(task.id)}: поля ${quote(task.field)} нет ни в карточке, ни в заметках`, {
        sideTaskId: task.id,
        fieldId: task.field,
      });
    }
  }
}

/**
 * Состояния, до которых можно дойти от старта: обычными переходами и общими (кроме конечных и исключённых).
 * «Срок вышел» (`schedule.deadlineState`) — тоже вход: срок может выйти в любой момент разговора.
 */
function reachableFrom(flow: AgentFlow, start: FlowState): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  const deadline = flow.schedule?.deadlineState === undefined ? undefined : stateById(flow, flow.schedule.deadlineState);
  if (deadline) queue.push(deadline);
  while (queue.length > 0) {
    const state = queue.shift()!;
    if (seen.has(state.id)) continue;
    seen.add(state.id);
    const exits = commonApplies(flow, state) ? [...state.exits, ...flow.anyState.exits] : state.exits;
    for (const exit of exits) {
      const next = stateById(flow, exit.to);
      if (next && !seen.has(next.id)) queue.push(next);
    }
  }
  return seen;
}

export interface CheckFlowOptions {
  /** Свои проверки приложения: их находки идут после встроенных. Те же — в редакторе (`checks` у `FlowEditor`). */
  checks?: FlowAppChecks;
}

/** Ошибки и замечания сценария: недостижимые состояния, условия без цели, чужие имена инструментов… */
export function checkFlow(flow: AgentFlow, catalog: FlowCatalog, options: CheckFlowOptions = {}): FlowIssue[] {
  const issues = new Issues();
  checkDuplicates(flow, issues);

  const start = stateById(flow, flow.start);
  if (flow.start === null) issues.error("no_start", "Нет стартового состояния: отметьте, где начинается сценарий");
  else if (!start) issues.error("unknown_start", `Стартовое состояние ${quote(flow.start)} не найдено`);

  for (const tool of flow.tools) {
    if (!catalog.tools.includes(tool)) issues.error("unknown_tool", `Инструмента ${quote(tool)} нет у приложения`);
  }
  for (const state of flow.states) checkState(flow, catalog, issues, state);

  for (const stateId of flow.anyState.except) {
    if (!stateById(flow, stateId)) {
      issues.warning("unknown_except_state", `Общие переходы: исключено состояние ${quote(stateId)}, которого нет`, { stateId });
    }
  }
  flow.anyState.exits.forEach((exit, index) => checkExit(flow, catalog, issues, exit, index));
  checkSchedule(flow, issues);
  checkFlowNudges(flow, issues);
  checkSideTasks(flow, issues);

  if (start) {
    const reachable = reachableFrom(flow, start);
    const reported = new Set<string>();
    for (const state of flow.states) {
      if (reachable.has(state.id) || reported.has(state.id)) continue;
      reported.add(state.id);
      issues.error("unreachable_state", `${stateName(state)}: недостижимо — сюда не ведёт ни один переход от старта`, { stateId: state.id });
    }
    if (!flow.states.some((state) => reachable.has(state.id) && isFinal(state))) {
      issues.warning("no_reachable_end", "Нет достижимого конечного состояния: сценарий никогда не закончится сам");
    }
  }
  return [...issues.list, ...(options.checks ? appIssues(flow, options.checks(flow)) : [])];
}
