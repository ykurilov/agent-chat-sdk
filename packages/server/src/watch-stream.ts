import { publicAppState } from "@ykurilov/agent-chat-core";
import type { AgentChannel, ChatEvent, ChatTurnTrigger, HiddenStateKey, TaskView } from "@ykurilov/agent-chat-core";

/** Как часто поток сверяется с базой: конец ветки — всегда, задачи — пока они идут. */
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
  /** Задачи чата; нет фона — задачи не сверяются. */
  listTasks?: () => Promise<TaskView[]>;
  /**
   * Id последнего сообщения текущей ветки в базе (`null` — сообщений нет). Сверяется раз в 5 с: так видны ход, сообщение
   * и смена ветки, которые записала другая копия сервера (сообщение из мессенджера, вкладка на другой копии). Нет — не сверяется.
   */
  branchTail?: () => Promise<string | null>;
  /** Ход, ответ которого идёт в базе, но не на этой копии сервера, с источником и каналом по истории; нет — `null`. */
  detachedTurn(): Promise<{ messageId: string; trigger: ChatTurnTrigger; channel: AgentChannel } | null>;
  onClose(): void;
  logError(message: string, error?: unknown): void;
}

/** Сколько событий может ждать нечитающего клиента, прежде чем поток оборвётся. */
const MAX_QUEUED_EVENTS = 1000;

/**
 * События одного чата: ход начался, ход закончился, задачи изменились. Раз в 5 с поток сверяется с базой: так видны ход,
 * сообщения и задачи, которые ведёт другая копия сервера. Свои изменения этой копии приходят событиями сразу, сверка их
 * не повторяет.
 */
export function createWatchStream(options: WatchStreamOptions): ReadableStream<WatchEvent> {
  const { ownerId, chatId, listTasks } = options;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let lastTasks: string | undefined;
  /** Задачи шли на прошлой сверке (или изменились с тех пор): сверять их снова. */
  let tasksLive = false;
  /** Конец ветки на прошлой сверке; `undefined` — ещё не прочитан. */
  let lastTail: string | null | undefined;
  /** С прошлой спокойной сверки чат менялся на этой копии: такие перемены вкладка уже знает из событий. */
  let localActivity = false;
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
        if (closed) return;
        // Клиент не читает: очередь не копится без конца. Поток обрывается, клиент переподключится и перечитает чат.
        if ((controller.desiredSize ?? 0) < -MAX_QUEUED_EVENTS) {
          close();
          controller.error(new Error("watch consumer is not reading"));
          return;
        }
        controller.enqueue(event);
      };

      /** Задачи изменились с прошлой сверки — `tasks-changed`; возвращает, идут ли ещё задачи. */
      const checkTasks = async (): Promise<boolean> => {
        const tasks = await listTasks!();
        const snapshot = JSON.stringify(tasks);
        if (lastTasks !== undefined && snapshot !== lastTasks) send({ type: "tasks-changed", chatId });
        lastTasks = snapshot;
        return tasks.some((task) => LIVE_TASK_STATUSES.has(task.status));
      };

      /** Ход, который ведёт другая копия: `turn-started` один раз; возвращает, нашёлся ли такой ход. */
      const announceDetachedTurn = async (): Promise<boolean> => {
        const turn = await options.detachedTurn();
        if (!turn) return false;
        if (!announced.has(turn.messageId)) {
          announced.add(turn.messageId);
          send({ type: "turn-started", chatId, ...turn });
        }
        return true;
      };

      /** Конец ветки сменился не событием этой копии — ход другой копии или `message-added`, чтобы вкладка перечитала историю. */
      const checkTail = async () => {
        const tail = await options.branchTail!();
        if (lastTail === undefined || tail === lastTail) {
          lastTail = tail;
          localActivity = false;
          return;
        }
        lastTail = tail;
        if (localActivity || tail === null) return;
        if (!(await announceDetachedTurn())) send({ type: "message-added", chatId, messageId: tail });
      };

      const tick = async () => {
        timer = undefined;
        try {
          if (listTasks && tasksLive) {
            tasksLive = await checkTasks();
            // Задача могла начать ход на другой копии: как и до сверки конца ветки.
            await announceDetachedTurn();
          }
          if (options.branchTail) await checkTail();
        } catch (error) {
          options.logError(`Наблюдение за чатом ${chatId}: сверка с базой не удалась: ${error instanceof Error ? error.message : String(error)}`, error);
        }
        scheduleReconcile();
      };

      const scheduleReconcile = () => {
        if (closed || timer !== undefined || (!options.branchTail && !(listTasks && tasksLive))) return;
        timer = setTimeout(() => void tick(), WATCH_RECONCILE_EVERY_MS);
      };

      unsubscribe = options.subscribeEvents((event) => {
        if (event.ownerId !== ownerId || event.chatId !== chatId) return;
        // Данные чата остаются на сервере: о смене вкладка не узнаёт.
        if (event.type === "chat-data-changed") return;
        const { ownerId: _, ...forTab } = event;
        localActivity = true;
        if (event.type === "turn-started") announced.add(event.messageId);
        // Закрытые ключи состояния — только серверу.
        send(forTab.type === "state-changed" && options.hiddenStateKey ? { ...forTab, state: publicAppState(forTab.state, options.hiddenStateKey) } : forTab);
        // Задачи изменились — сверка снова нужна, даже если до этого задач не было.
        if (event.type === "tasks-changed") {
          tasksLive = true;
          scheduleReconcile();
        }
      });
      if (options.signal?.aborted) {
        onClientGone();
        return;
      }
      options.signal?.addEventListener("abort", onClientGone, { once: true });

      if (options.branchTail) {
        // Конец ветки при открытии — точка отсчёта: от неё сверка отличает новое.
        void options.branchTail().then(
          (tail) => {
            if (lastTail === undefined) lastTail = tail;
          },
          (error: unknown) => options.logError(`Наблюдение за чатом ${chatId}: конец ветки не прочитан: ${error instanceof Error ? error.message : String(error)}`, error),
        );
        scheduleReconcile();
      }
      if (listTasks) {
        void checkTasks()
          .then((live) => {
            tasksLive = live;
            if (live) scheduleReconcile();
          })
          .catch((error: unknown) => {
            options.logError(`Наблюдение за чатом ${chatId}: задачи не прочитаны: ${error instanceof Error ? error.message : String(error)}`, error);
            // Идут ли задачи, неизвестно: сверка повторится, как после сбоя очередной сверки.
            tasksLive = true;
            scheduleReconcile();
          });
      }
    },
    cancel() {
      close();
    },
  });
}
