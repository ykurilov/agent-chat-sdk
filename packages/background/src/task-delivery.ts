import type { AgentNotice, BackgroundPort } from "@ykurilov/agent-chat-core";
import { NOTICE_STATUSES } from "./store/task-store";
import type { TaskRecord, TaskStore } from "./types";

/** Предел итога в служебном сообщении: как предел результата инструмента в ядре. */
const NOTICE_RESULT_MAX_LENGTH = 50_000;

/** Без пробуждения агента: человек сам отменил или задача ждёт его решения. Доставляются раньше остальных. */
const isQuiet = (task: TaskRecord) => task.status === "canceled" || task.status === "awaiting_approval";

export interface TaskDelivery {
  /** В чате есть недоставленные итоги, которые держит эта копия: доставить сейчас или, если чат занят, позже. */
  request(ownerId: string, chatId: string): Promise<void>;
  /** Ход чата закончился: если чат ждал доставки — пора. */
  chatFree(ownerId: string, chatId: string): void;
  /** Повтор для всех чатов, где доставка не удалась (обход по таймеру). */
  retryPending(): Promise<void>;
  forget(ownerId: string, chatId: string): void;
  /** Дождаться доставок, которые уже идут. */
  idle(): Promise<void>;
}

/**
 * Доставка итогов задач в чат служебными сообщениями. Копия доставляет только задачи со своей арендой. Готовые задачи
 * чата уходят пачками с ключом из ключей задач: повтор после сбоя ядро не повторит.
 */
export function createTaskDelivery(deps: { store: TaskStore; leaseOwner: string; port(): BackgroundPort }): TaskDelivery {
  const { store, leaseOwner } = deps;
  const pending = new Map<string, { ownerId: string; chatId: string }>();
  const inFlight = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const chatKey = (ownerId: string, chatId: string) => `${ownerId}\u0000${chatId}`;

  /** `wait` — чат занят или доставка не удалась: остаётся в ожидании. */
  async function deliverOnce(ownerId: string, chatId: string): Promise<"done" | "wait"> {
    const tasks = (await store.listUndelivered(ownerId, chatId)).filter((task) => task.leaseOwner === leaseOwner);
    const delivered: string[] = [];
    for (const group of await batchesOf(ownerId, tasks)) {
      const result = await deps.port().deliverNotices({
        ownerId,
        chatId,
        notices: group.tasks.map(noticeOf),
        wakeAgent: !group.tasks.every(isQuiet),
        deliveryKey: group.key,
      });
      if (result.status === "busy") return "wait";
      if (result.status === "chat_gone") {
        // Чата больше нет: итогам некуда идти, задачи отменены. Задачу, которую тем временем продолжили, ведёт та копия.
        const left = tasks.filter((task) => !delivered.includes(task.id));
        const now = new Date().toISOString();
        for (const task of left) {
          await store.update(
            ownerId,
            task.id,
            { status: "canceled", finishedAt: task.finishedAt ?? now, deliveredAt: now, leaseOwner: undefined, leaseUntil: undefined },
            { leaseOwner, statuses: NOTICE_STATUSES },
          );
        }
        return "done";
      }
      const ids = group.tasks.map((task) => task.id);
      await store.markDelivered(ids, group.key, new Date().toISOString());
      delivered.push(...ids);
    }
    return "done";
  }

  /**
   * Пачки доставки, тихие раньше громких. Начатая пачка (ключ сохранён в задачах) повторяется как была: ядро узнает
   * ключ и не запишет её второй раз, даже если готовых задач за это время стало больше. Ключ новой пачки сохраняется
   * в задачах до отправки.
   */
  async function batchesOf(ownerId: string, tasks: TaskRecord[]): Promise<Array<{ key: string; tasks: TaskRecord[] }>> {
    const batches = new Map<string, TaskRecord[]>();
    for (const task of tasks) if (task.deliveryKey) batches.set(task.deliveryKey, [...(batches.get(task.deliveryKey) ?? []), task]);
    const fresh = tasks.filter((task) => !task.deliveryKey);
    for (const group of [fresh.filter(isQuiet), fresh.filter((task) => !isQuiet(task))]) {
      if (group.length === 0) continue;
      const key = group.map(deliveryKeyOf).join("+");
      const kept: TaskRecord[] = [];
      // Задачу, которую тем временем забрала другая копия, эта не доставляет.
      for (const task of group) if (await store.update(ownerId, task.id, { deliveryKey: key }, { leaseOwner })) kept.push(task);
      if (kept.length > 0) batches.set(key, kept);
    }
    const quietFirst = (group: TaskRecord[]) => (group.every(isQuiet) ? 0 : 1);
    return [...batches]
      .map(([key, group]) => ({ key, tasks: group }))
      .sort((a, b) => quietFirst(a.tasks) - quietFirst(b.tasks));
  }

  function drain(ownerId: string, chatId: string): Promise<void> {
    const key = chatKey(ownerId, chatId);
    const running = inFlight.get(key);
    if (running) {
      again.add(key);
      return running;
    }
    const work = (async () => {
      try {
        let outcome: "done" | "wait";
        do {
          again.delete(key);
          outcome = await deliverOnce(ownerId, chatId).catch((error: unknown) => {
            deps.port().logError(error);
            return "wait" as const;
          });
        } while (again.has(key));
        if (outcome === "done") pending.delete(key);
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, work);
    return work;
  }

  return {
    request(ownerId, chatId) {
      pending.set(chatKey(ownerId, chatId), { ownerId, chatId });
      return drain(ownerId, chatId);
    },
    chatFree(ownerId, chatId) {
      if (pending.has(chatKey(ownerId, chatId))) void drain(ownerId, chatId);
    },
    async retryPending() {
      await Promise.all([...pending.values()].map(({ ownerId, chatId }) => drain(ownerId, chatId)));
    },
    forget(ownerId, chatId) {
      pending.delete(chatKey(ownerId, chatId));
    },
    async idle() {
      await Promise.allSettled([...inFlight.values()]);
    },
  };
}

function deliveryKeyOf(task: TaskRecord): string {
  const approvalId = task.status === "awaiting_approval" ? task.progress?.pendingApproval?.approvalId : undefined;
  return approvalId ? `task:${task.id}:approval:${approvalId}` : `task:${task.id}`;
}

/** Служебное сообщение о задаче, как его видят модель и экран. */
export function noticeOf(task: TaskRecord): AgentNotice {
  const base = { taskId: task.id, title: task.title };
  switch (task.status) {
    case "done":
      return {
        kind: "task_done",
        ...base,
        ...(task.result !== undefined && { result: noticeResult(task.result) }),
        // Помощник брал чужой текст: чат с этим итогом живые демонстрации не запускает.
        ...(task.progress?.externalContent && { externalContent: true as const }),
      };
    case "failed":
      return { kind: "task_failed", ...base, error: task.error ?? "неизвестная ошибка" };
    case "timed_out":
      return { kind: "task_timed_out", ...base, ...(task.error && { error: task.error }) };
    case "canceled":
      return { kind: "task_canceled", ...base };
    case "awaiting_approval": {
      const pendingApproval = task.progress?.pendingApproval;
      return {
        kind: "task_awaiting_approval",
        ...base,
        ...(pendingApproval && { approval: { approvalId: pendingApproval.approvalId, toolName: pendingApproval.toolName, input: pendingApproval.input } }),
      };
    }
    default:
      return { kind: "task_interrupted", ...base };
  }
}

/** Итог строкой (объект — JSON), обрезанный пределом: модель получает его в хвосте запроса. */
function noticeResult(result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  if (text.length <= NOTICE_RESULT_MAX_LENGTH) return text;
  const tail = `\n… (итог обрезан: всего ${text.length} знаков)`;
  return text.slice(0, NOTICE_RESULT_MAX_LENGTH - tail.length) + tail;
}
