import type { AgentFlow, FlowIssue, FlowIssueLevel } from "../format/flow-format";

// Свои проверки приложения в «Проверить сценарий»: приложение пишет `{ path, message }` по месту в JSON сценария
// (`states[2]`, `states[0].exits[1]`, `sideTasks[0]`) или готовую находку с `place`. Редактор переводит путь в место.

/** Находка приложения: путь в JSON сценария или готовое место. Нет `level` — ошибка, нет `code` — `app_check`. */
export interface FlowAppIssue {
  message: string;
  level?: FlowIssueLevel;
  code?: string;
  /** `states[2]`, `states[intro].exits[0]`, `anyState.exits[0]`, `clientCard[1]`, `chatNotes[0]`, `sideTasks[0]`. */
  path?: string;
  place?: FlowIssue["place"];
}

/** Проверки приложения: одни и те же в `checkFlow(flow, catalog, { checks })` на сервере и в `checks` у `FlowEditor`. */
export type FlowAppChecks = (flow: AgentFlow) => readonly FlowAppIssue[];

/** Элемент списка по `[номер]` или `[id]`. */
function pick<T extends { id: string }>(items: readonly T[] | undefined, key: string | undefined): T | undefined {
  if (!items || key === undefined) return undefined;
  return /^\d+$/.test(key) ? items[Number(key)] : items.find((item) => item.id === key);
}

/** Место находки по пути в JSON сценария; непонятный путь — весь сценарий. */
export function placeOfPath(flow: AgentFlow, path: string): FlowIssue["place"] {
  const state = /^states\[([^\]]+)\](?:\.exits\[([^\]]+)\])?/.exec(path);
  if (state) {
    const found = pick(flow.states, state[1]);
    if (!found) return {};
    const exit = pick(found.exits, state[2]);
    return exit ? { stateId: found.id, exitId: exit.id } : { stateId: found.id };
  }
  const any = /^anyState\.exits\[([^\]]+)\]/.exec(path);
  if (any) {
    const exit = pick(flow.anyState.exits, any[1]);
    return exit ? { exitId: exit.id } : {};
  }
  const field = /^(clientCard|chatNotes)\[([^\]]+)\]/.exec(path);
  if (field) {
    const found = pick<{ id: string }>(flow[field[1] as "clientCard" | "chatNotes"], field[2]);
    return found ? { fieldId: found.id } : {};
  }
  const task = /^sideTasks\[([^\]]+)\]/.exec(path);
  if (task) {
    const found = pick(flow.sideTasks, task[1]);
    return found ? { sideTaskId: found.id } : {};
  }
  return {};
}

/** Находки приложения как находки `checkFlow`. */
export function appIssues(flow: AgentFlow, found: readonly FlowAppIssue[]): FlowIssue[] {
  return found.map((issue) => ({
    level: issue.level ?? "error",
    code: issue.code ?? "app_check",
    message: issue.message,
    place: issue.place ?? (issue.path === undefined ? {} : placeOfPath(flow, issue.path)),
  }));
}
