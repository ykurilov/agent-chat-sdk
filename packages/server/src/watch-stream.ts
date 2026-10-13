import { publicAppState } from "@ykurilov/agent-chat-core";
import type { AgentChannel, ChatEvent, ChatTurnTrigger, HiddenStateKey, TaskView } from "@ykurilov/agent-chat-core";

/** Как часто поток сверяется с базой, пока у чата идут задачи. */
export const WATCH_RECONCILE_EVERY_MS = 5000;

/** Событие для вкладки: без владельца — он ей не нужен. */
export type WatchEvent = ChatEvent extends infer Event ? (Event extends unknown ? Omit<Event, "ownerId"> : never) : never;

const LIVE_TASK_STATUSES: ReadonlySet<TaskView["status"]> = new Set(["queued", "running", "awaiting_approval"]);

export interface WatchStreamOptions {
  ownerId: string;
  chatId: string;
  /** Запрос вкладки: клиент ушёл — поток закрывается, даже если его так и не начали читать. */
  signal?: AbortSignal;
  subscribeEvents(listener: (event: ChatEvent) => void): () => void;
  /** Ключи состояния, которые не уходят вкладке в `state-changed`; нет — только служебные ключи SDK. */
  hiddenStateKey?: HiddenStateKey;
  /** Задачи чата; нет фона — сверки нет. */
  listTasks?: () => Promise<TaskView[]>;
  /** Ход, ответ которого идёт в базе, но не на этой копии сервера, с источником и каналом по истории; нет — `null`. */
  detachedTurn(): Promise<{ messageId: string; trigger: ChatTurnTrigger; channel: AgentChannel } | null>;
  onClose(): void;
  logError(message: string): void;
}

/**
 * События одного чата: ход начался, ход закончился, задачи изменились. Пока у чата идут задачи, раз в 5 с поток
 * сверяется с базой: так видны ход и задачи, которые ведёт другая копия сервера.
 */
export function createWatchStream(options: WatchStreamOptions): ReadableStream<WatchEvent> {
  const { ownerId, chatId, listTasks } = options;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let lastTasks: string | undefined;
  const announced = new Set<string>();

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    unsubscribe?.();
    options.signal?.removeEventListener("abort", onClientGone);
    options.onClose();
  };
  let onClientGone = () => close();

  return new ReadableStream<WatchEvent>({
    start(controller) {
      onClientGone = () => {
        const wasOpen = !closed;
        close();
        if (wasOpen) controller.close();
      };
      const send = (event: WatchEvent) => {
        if (!closed) controller.enqueue(event);
      };

      /** Задачи изменились с прошлой сверки — `tasks-changed`; возвращает, идут ли ещё задачи. */
      const checkTasks = async (): Promise<boolean> => {
        const tasks = await listTasks!();
        const snapshot = JSON.stringify(tasks);
        if (lastTasks !== undefined && snapshot !== lastTasks) send({ type: "tasks-changed", chatId });
        lastTasks = snapshot;
        return tasks.some((task) => LIVE_TASK_STATUSES.has(task.status));
      };

      const tick = async () => {
        timer = undefined;
        try {
          const live = await checkTasks();
          const turn = await options.detachedTurn();
          if (turn && !announced.has(turn.messageId)) {
            announced.add(turn.messageId);
            send({ type: "turn-started", chatId, ...turn });
          }
          if (live) scheduleReconcile();
        } catch (error) {
          options.logError(`Наблюдение за чатом ${chatId}: сверка с базой не удалась: ${error instanceof Error ? error.message : String(error)}`);
          scheduleReconcile();
        }
      };

      const scheduleReconcile = () => {
        if (closed || timer !== undefined || !listTasks) return;
        timer = setTimeout(() => void tick(), WATCH_RECONCILE_EVERY_MS);
      };

      unsubscribe = options.subscribeEvents((event) => {
        if (event.ownerId !== ownerId || event.chatId !== chatId) return;
        // Данные чата остаются на сервере: о смене вкладка не узнаёт.
        if (event.type === "chat-data-changed") return;
        const { ownerId: _, ...forTab } = event;
        if (event.type === "turn-started") announced.add(event.messageId);
        // Закрытые ключи состояния — только серверу.
        send(forTab.type === "state-changed" && options.hiddenStateKey ? { ...forTab, state: publicAppState(forTab.state, options.hiddenStateKey) } : forTab);
        // Задачи изменились — сверка снова нужна, даже если до этого задач не было.
        if (event.type === "tasks-changed") scheduleReconcile();
      });
      if (options.signal?.aborted) {
        onClientGone();
        return;
      }
      options.signal?.addEventListener("abort", onClientGone, { once: true });

      if (listTasks) {
        void checkTasks()
          .then((live) => {
            if (live) scheduleReconcile();
          })
          .catch((error: unknown) => {
            options.logError(`Наблюдение за чатом ${chatId}: задачи не прочитаны: ${error instanceof Error ? error.message : String(error)}`);
            // Идут ли задачи, неизвестно: сверка повторится, как после сбоя очередной сверки.
            scheduleReconcile();
          });
      }
    },
    cancel() {
      close();
    },
  });
}
