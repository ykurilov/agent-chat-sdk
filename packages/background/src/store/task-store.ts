import type { TaskStatus } from "@ykurilov/agent-chat-core";
import type { TaskCondition, TaskPatch, TaskRecord } from "../types";

/**
 * Жизнь задачи в хранилище.
 * - `queued`/`running` — идёт; аренда у копии сервера, которая её ведёт.
 * - `awaiting_approval` и законченные — ждут доставки служебного сообщения; аренда у копии, которая доставляет.
 * - `delivered_at` стоит — чату всё сообщено, аренды нет, задача никому не нужна до следующего события.
 * Поэтому «задаче нужна копия сервера» — ровно `delivered_at IS NULL`.
 */
export const RUNNING_STATUSES = ["queued", "running"] as const satisfies readonly TaskStatus[];
export const FINISHED_STATUSES = ["done", "failed", "canceled", "interrupted", "timed_out"] as const satisfies readonly TaskStatus[];
/** О чём чат получает служебное сообщение. */
export const NOTICE_STATUSES = [...FINISHED_STATUSES, "awaiting_approval"] as const satisfies readonly TaskStatus[];

export const isRunningStatus = (status: TaskStatus): boolean => (RUNNING_STATUSES as readonly TaskStatus[]).includes(status);
export const isFinishedStatus = (status: TaskStatus): boolean => (FINISHED_STATUSES as readonly TaskStatus[]).includes(status);

/** Поля записи, которые хранилище может не хранить: `null` из базы и `undefined` из правки значат «нет». */
const OPTIONAL_FIELDS = [
  "input",
  "helperMessages",
  "progress",
  "result",
  "error",
  "leaseOwner",
  "leaseUntil",
  "startedAt",
  "finishedAt",
  "deliveredAt",
  "deliveryKey",
] as const satisfies readonly (keyof TaskRecord)[];

/** Выполнено ли условие записи для задачи. */
export function meetsCondition(task: TaskRecord, when: TaskCondition | undefined): boolean {
  if (when?.leaseOwner !== undefined && task.leaseOwner !== when.leaseOwner) return false;
  if (when?.statuses !== undefined && !when.statuses.includes(task.status)) return false;
  if (when?.pendingApprovalId !== undefined && task.progress?.pendingApproval?.approvalId !== when.pendingApprovalId) return false;
  return true;
}

/** Убирает пустые необязательные поля: запись из любого хранилища выглядит одинаково. */
export function withoutEmptyFields(record: TaskRecord): TaskRecord {
  const clean = { ...record } as Record<string, unknown>;
  for (const field of OPTIONAL_FIELDS) {
    if (clean[field] === null || clean[field] === undefined) delete clean[field];
  }
  return clean as unknown as TaskRecord;
}

/** Правка (или вся запись) как пары «поле — значение»: переданный `undefined` стирает поле (`null` в базе). */
export function patchEntries(patch: TaskPatch | TaskRecord): Array<[string, unknown]> {
  return Object.entries(patch).map(([key, value]) => [key, value ?? null]);
}

/** PostgreSQL не хранит символ NUL ни в тексте, ни в jsonb: убираем его до записи. */
export function withoutNul<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replaceAll("\u0000", "") as T;
  if (typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === "string" ? item.replaceAll("\u0000", "") : item))) as T;
}
