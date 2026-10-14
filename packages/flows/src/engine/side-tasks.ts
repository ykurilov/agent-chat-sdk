import { DEFAULT_SIDE_TASK_MAX_ATTEMPTS, type AgentFlow, type FlowSideTask } from "../format/flow-format";
import type { FlowRun } from "./flow-run";
import { fieldValueFits } from "./data-conditions";
import { fieldById, isFinal, stateById } from "./flow-graph";

// Попутные задачи: дела между делом («предложить подписаться на канал»). Темп общий с вопросами о человеке
// (`pace.sideQuestionEveryMessages`), попыток у задачи не больше `maxAttempts`, решённая не всплывает.

/** Попытки задачи, как их отдаёт хранилище: на человека (`chatId: null`) или на разговор. */
export interface SideTaskAttempts {
  taskId: string;
  chatId: string | null;
  asks: number;
  doneAt: string | null;
}

/** Встроенная задача: пока пояс человека неизвестен, в первый день до ночи узнать город (В1). Первая по важности. */
export const TIME_ZONE_TASK_ID = "ask_time_zone";
export const TIME_ZONE_TASK: FlowSideTask = {
  id: TIME_ZONE_TASK_ID,
  text: "Узнай, из какого человек города, чтобы писать ему в удобное время. Узнал город — запиши его пояс через «flow_time_zone» и отметь задачу решённой.",
  when: "в первый день, до ночи; например: «Кстати, вы откуда? Хочу писать вам в удобное время»",
  maxAttempts: DEFAULT_SIDE_TASK_MAX_ATTEMPTS,
  perConversation: false,
};

/** Задача по id: встроенная «узнать город» — только у сценария с «Днями и временем», иначе задача сценария. */
export function sideTaskById(flow: AgentFlow, id: string): FlowSideTask | undefined {
  if (id === TIME_ZONE_TASK_ID && flow.schedule) return TIME_ZONE_TASK;
  return flow.sideTasks?.find((task) => task.id === id);
}

/** Есть ли у сценария попутные задачи: свои или встроенная. Нет — ни инструмента, ни правила, ни строки (как в 0.48). */
export const hasSideTasks = (flow: AgentFlow) => flow.schedule !== undefined || (flow.sideTasks?.length ?? 0) > 0;

export interface SideTaskContext {
  flow: AgentFlow;
  run: FlowRun;
  /** Разговор, в котором идёт ход: по нему считаются попытки задач «заново в каждом разговоре». */
  chatId: string;
  attempts: readonly SideTaskAttempts[];
  /** Значения карточки клиента по `id` поля. Заметки чата берутся из `run.notes`. */
  card: Readonly<Record<string, unknown>>;
  /** Пояс человека неизвестен, а сегодня его первый день до первой ночи: тогда открыта встроенная задача «узнать город». Отдаёт этап 4. */
  askTimeZone?: boolean;
}

export type OpenSideTasksInput = SideTaskContext;

/** Решена ли задача: отмечена или её поле уже известно. Потрачена ли: попытки кончились. Иначе — открыта. */
export type SideTaskStanding = "open" | "done" | "spent";

/** Попытки задачи: на человека — запись без разговора, у «заново в каждом разговоре» — запись этого разговора. */
export function sideTaskRecord(task: FlowSideTask, chatId: string, attempts: readonly SideTaskAttempts[]): SideTaskAttempts | undefined {
  const owner = task.perConversation ? chatId : null;
  return attempts.find((record) => record.taskId === task.id && record.chatId === owner);
}

/** Известно ли поле задачи: значение подходит типу поля. Поля нет в сценарии — не известно. */
export function sideTaskFieldKnown(task: FlowSideTask, context: Pick<SideTaskContext, "flow" | "run" | "card">): boolean {
  if (task.field === undefined) return false;
  const found = fieldById(context.flow, task.field);
  if (!found) return false;
  return fieldValueFits(found.field, found.place === "notes" ? context.run.notes[task.field] : context.card[task.field]);
}

/** Где задача сейчас — без учёта темпа и места в сценарии. */
export function sideTaskStanding(task: FlowSideTask, context: SideTaskContext): SideTaskStanding {
  const record = sideTaskRecord(task, context.chatId, context.attempts);
  if (record?.doneAt || sideTaskFieldKnown(task, context)) return "done";
  return (record?.asks ?? 0) >= task.maxAttempts ? "spent" : "open";
}

/** Прошло ли с прошлого вопроса или задачи между делом столько сообщений человека, сколько велит `pace`. */
export function sideTaskPaceReached(flow: AgentFlow, run: FlowRun): boolean {
  return run.sideQuestionAt === null || run.humanMessages - run.sideQuestionAt >= flow.pace.sideQuestionEveryMessages;
}

/**
 * Задачи, которые агент может предложить сейчас: открытые, и только если темп позволяет, состояние не «без вопросов» и
 * сценарий не кончился. Порядок — как в сценарии. Встроенная «узнать город» — первой и вне общего темпа: у неё только
 * первый день до ночи. Задач нет — пусто, как в 0.48.
 */
export function openSideTasks(input: OpenSideTasksInput): FlowSideTask[] {
  const { flow, run } = input;
  const state = stateById(flow, run.state);
  if (!state || isFinal(state) || state.noSideQuestions) return [];
  const askCity = input.askTimeZone === true && flow.schedule !== undefined && sideTaskStanding(TIME_ZONE_TASK, input) === "open";
  const own = sideTaskPaceReached(flow, run) ? (flow.sideTasks ?? []).filter((task) => sideTaskStanding(task, input) === "open") : [];
  return askCity ? [TIME_ZONE_TASK, ...own] : own;
}
