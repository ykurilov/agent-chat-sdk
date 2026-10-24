import type { TaskCondition, TaskPatch, TaskRecord, TaskStore } from "../types";
import { isRunningStatus, meetsCondition, NOTICE_STATUSES, patchEntries, withoutEmptyFields } from "./task-store";

const copy = (record: TaskRecord): TaskRecord => withoutEmptyFields(structuredClone(record));
const byCreatedAt = (left: TaskRecord, right: TaskRecord) => left.createdAt.localeCompare(right.createdAt);

/** Задачи в памяти процесса: для разработки и тестов. Перезапуск их теряет, две копии сервера их не делят. */
export function memoryTaskStore(): TaskStore {
  const tasks = new Map<string, TaskRecord>();

  const owned = (ownerId: string, taskId: string) => {
    const task = tasks.get(taskId);
    return task && task.ownerId === ownerId ? task : undefined;
  };
  const countActive = (ownerId: string) => [...tasks.values()].filter((task) => task.ownerId === ownerId && isRunningStatus(task.status)).length;
  const update = (ownerId: string, taskId: string, patch: TaskPatch, when: TaskCondition | undefined): TaskRecord | null => {
    const task = owned(ownerId, taskId);
    if (!task || !meetsCondition(task, when)) return null;
    const changed = { ...task } as Record<string, unknown>;
    for (const [key, value] of patchEntries(structuredClone(patch))) changed[key] = value;
    const next = withoutEmptyFields(changed as unknown as TaskRecord);
    tasks.set(taskId, next);
    return copy(next);
  };
  const isFree = (task: TaskRecord, leaseOwner: string, now: string) =>
    task.leaseOwner === leaseOwner || task.leaseUntil === undefined || task.leaseUntil < now;

  return {
    async create(task) {
      tasks.set(task.id, copy(task));
    },
    async get(ownerId, taskId) {
      const task = owned(ownerId, taskId);
      return task ? copy(task) : null;
    },
    async update(ownerId, taskId, patch, when) {
      return update(ownerId, taskId, patch, when);
    },
    async listForChat(ownerId, chatId) {
      return [...tasks.values()].filter((task) => task.ownerId === ownerId && task.chatId === chatId).sort(byCreatedAt).map(copy);
    },
    async countActive(ownerId) {
      return countActive(ownerId);
    },
    async admitWithinLimit(admission, maxActive) {
      // Без ожиданий между подсчётом и записью: в памяти одного процесса это и есть одно действие.
      const ownerId = "create" in admission ? admission.create.ownerId : admission.resume.ownerId;
      if (countActive(ownerId) >= maxActive) return "no_slot";
      if ("create" in admission) {
        tasks.set(admission.create.id, copy(admission.create));
        return copy(admission.create);
      }
      const { taskId, patch, when } = admission.resume;
      return update(ownerId, taskId, patch, when);
    },
    async claim(taskId, leaseOwner, leaseUntil, now) {
      const task = tasks.get(taskId);
      if (!task || task.deliveredAt !== undefined || !isFree(task, leaseOwner, now)) return null;
      const next: TaskRecord = isRunningStatus(task.status)
        ? { ...task, status: "running", attempt: task.attempt + 1, startedAt: task.startedAt ?? now, leaseOwner, leaseUntil }
        : { ...task, leaseOwner, leaseUntil };
      tasks.set(taskId, next);
      return copy(next);
    },
    async renewLease(taskId, leaseOwner, leaseUntil) {
      const task = tasks.get(taskId);
      if (!task || task.deliveredAt !== undefined || task.leaseOwner !== leaseOwner) return false;
      tasks.set(taskId, { ...task, leaseUntil });
      return true;
    },
    async listExpired(now) {
      return [...tasks.values()].filter((task) => task.deliveredAt === undefined && (task.leaseUntil === undefined || task.leaseUntil < now)).map(copy);
    },
    async listUndelivered(ownerId, chatId) {
      return [...tasks.values()]
        .filter((task) => task.ownerId === ownerId && task.chatId === chatId && task.deliveredAt === undefined)
        .filter((task) => (NOTICE_STATUSES as readonly string[]).includes(task.status))
        .sort(byCreatedAt)
        .map(copy);
    },
    async markDelivered(taskIds, deliveryKey, at) {
      for (const taskId of taskIds) {
        const task = tasks.get(taskId);
        if (!task || task.deliveryKey !== deliveryKey || !(NOTICE_STATUSES as readonly string[]).includes(task.status)) continue;
        const { leaseOwner: _owner, leaseUntil: _until, ...rest } = task;
        tasks.set(taskId, { ...rest, deliveredAt: at });
      }
    },
    async deleteForChat(ownerId, chatId) {
      for (const [taskId, task] of tasks) if (task.ownerId === ownerId && task.chatId === chatId) tasks.delete(taskId);
    },
  };
}
