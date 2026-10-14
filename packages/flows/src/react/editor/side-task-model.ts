import { fieldById } from "../../engine/flow-graph";
import {
  DEFAULT_SIDE_TASK_MAX_ATTEMPTS,
  type AgentFlow,
  type ClientCardField,
  type FlowCatalog,
  type FlowCatalogField,
  type FlowField,
  type FlowSideTask,
} from "../../format/flow-format";
import type { FieldList } from "./editor-model";

// Правки попутных задач и полей из словаря приложения (`catalog.fields`): чистые функции, каждая возвращает новый `AgentFlow`.

function freeTaskId(flow: AgentFlow): string {
  const used = new Set((flow.sideTasks ?? []).map((task) => task.id));
  let index = 1;
  while (used.has(`task_${index}`)) index += 1;
  return `task_${index}`;
}

function withTasks(flow: AgentFlow, tasks: FlowSideTask[]): AgentFlow {
  if (tasks.length > 0) return { ...flow, sideTasks: tasks };
  const { sideTasks: _empty, ...rest } = flow;
  return rest;
}

export function addSideTask(flow: AgentFlow, text: string): { flow: AgentFlow; sideTaskId: string } {
  const sideTaskId = freeTaskId(flow);
  const task: FlowSideTask = { id: sideTaskId, text, maxAttempts: DEFAULT_SIDE_TASK_MAX_ATTEMPTS, perConversation: false };
  return { sideTaskId, flow: withTasks(flow, [...(flow.sideTasks ?? []), task]) };
}

export type SideTaskPatch = { [K in keyof FlowSideTask]?: FlowSideTask[K] | undefined };

/** Правка задачи: пустые «когда» и «поле» убираются, попыток — хотя бы одна. */
export function updateSideTask(flow: AgentFlow, sideTaskId: string, patch: SideTaskPatch): AgentFlow {
  return withTasks(
    flow,
    (flow.sideTasks ?? []).map((task) => {
      if (task.id !== sideTaskId) return task;
      const next: Record<string, unknown> = { ...task, ...patch };
      for (const key of ["when", "field"] as const) if (next[key] === undefined || next[key] === "") delete next[key];
      if (patch.maxAttempts !== undefined) next.maxAttempts = Math.max(1, Math.round(patch.maxAttempts) || 1);
      return next as unknown as FlowSideTask;
    }),
  );
}

export function removeSideTask(flow: AgentFlow, sideTaskId: string): AgentFlow {
  return withTasks(flow, (flow.sideTasks ?? []).filter((task) => task.id !== sideTaskId));
}

/** Поля словаря приложения, которых ещё нет ни в карточке, ни в заметках. */
export function catalogFieldsToAdd(flow: AgentFlow, catalog: FlowCatalog): FlowCatalogField[] {
  return (catalog.fields ?? []).filter((field) => !fieldById(flow, field.id));
}

/** Поле словаря приложения в карточку или заметки: id, название, тип и варианты — как у приложения. Уже есть — без правок. */
export function addCatalogField(flow: AgentFlow, list: FieldList, field: FlowCatalogField): AgentFlow {
  if (fieldById(flow, field.id)) return flow;
  const base: FlowField = { id: field.id, name: field.title, about: "", type: field.type, options: field.type === "choice" ? [...(field.options ?? [])] : [] };
  if (list === "clientCard") {
    const card: ClientCardField = { ...base, refreshAfterMonths: null };
    return { ...flow, clientCard: [...flow.clientCard, card] };
  }
  return { ...flow, chatNotes: [...flow.chatNotes, base] };
}

/** Поле, по которому задача решена. Поле из словаря приложения, которого нет в сценарии, попадает в карточку. */
export function setSideTaskField(flow: AgentFlow, sideTaskId: string, fieldId: string | null, catalog: FlowCatalog): AgentFlow {
  const fromApp = fieldId === null ? undefined : catalog.fields?.find((field) => field.id === fieldId);
  const withField = fromApp ? addCatalogField(flow, "clientCard", fromApp) : flow;
  return updateSideTask(withField, sideTaskId, { field: fieldId ?? undefined });
}
