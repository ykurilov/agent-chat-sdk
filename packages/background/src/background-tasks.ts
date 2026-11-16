import { randomUUID } from "node:crypto";
import type { BackgroundPort, BackgroundTasks, TaskView } from "@ykurilov/agent-chat-core";
import type { ToolSet } from "ai";
import { startFromApp } from "./app-start";
import type { StartTaskRequest, StartTaskResult } from "./app-start";
import { backgroundToolForTurn, runBackgroundTool } from "./background-tool";
import { backgroundHelpers, HELPER_TOOL_PREFIX, helperToolForTurn, runHelperTask } from "./helper-task";
import { createTaskDelivery } from "./task-delivery";
import { createTaskRunner } from "./task-runner";
import type { TaskPlan } from "./task-runner";
import { backgroundInstructions, CANCEL_TASK, CHECK_TASKS, taskToolsForTurn } from "./task-tools";
import type { BackgroundToolDefinition, TaskRecord, TaskStore } from "./types";

const DEFAULT_MAX_RUNNING_PER_USER = 3;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_LEASE_MS = 30_000;
/** Меньше аренды не бывает: продление раз в треть аренды должно успевать даже под нагрузкой. */
const MIN_LEASE_MS = 3_000;
/** Как у имён инструментов у провайдеров моделей. */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export interface BackgroundTasksOptions {
  /** `memoryTaskStore()`, `sqliteTaskStore(path)`, `postgresTaskStore(pool)`. */
  store: TaskStore;
  tools?: Record<string, BackgroundToolDefinition>;
  /** Сколько задач человека идёт одновременно; по умолчанию 3. */
  maxRunningPerUser?: number;
  /** Предел времени задачи; по умолчанию 30 минут. */
  timeoutMs?: number;
  /** Аренда задачи; по умолчанию 30 с, продление раз в треть аренды. */
  leaseMs?: number;
}

/** Фон для службы чата и для кода приложения: `start` запускает задачу без хода модели. */
export interface BackgroundTaskService extends BackgroundTasks {
  /**
   * Запуск фонового инструмента из кода приложения (сервер принял файл — пора разбирать), без хода модели. Дальше — как
   * у задачи, запущенной моделью: карточка с «Отменить» и ходом, предел `maxRunningPerUser` (общий с задачами модели и
   * между копиями сервера), перезапуск, итог служебным сообщением с ходом агента. Модель узнаёт из служебного сообщения,
   * что задачу запустило приложение. Чат занят ходом — задача всё равно запускается, итог придёт после хода.
   * @throws TypeError инструмента `name` нет в `tools` или вход не прошёл проверку его схемы: ничего не записано.
   * @throws ChatNotFoundError чата нет или он чужой: ничего не записано.
   * @throws Error фон не подключён к службе чата или уже остановлен (`flush`).
   */
  start(request: StartTaskRequest): Promise<StartTaskResult>;
}

/**
 * Фоновые задачи для службы чата: агент запускает долгую работу, разговор идёт дальше, итог приходит служебным
 * сообщением. Задачи переживают перезапуск сервера; несколько копий сервера на одной базе делят их по аренде.
 */
export function createBackgroundTasks(options: BackgroundTasksOptions): BackgroundTaskService {
  const { store } = options;
  const tools = options.tools ?? {};
  const maxRunningPerUser = options.maxRunningPerUser ?? DEFAULT_MAX_RUNNING_PER_USER;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  checkOptions(tools, maxRunningPerUser, timeoutMs, leaseMs);
  if (typeof (store as Partial<TaskStore>).admitWithinLimit !== "function") {
    throw new Error("Фоновые задачи: у хранилища задач нет admitWithinLimit — без него предел maxRunningPerUser не держится между копиями сервера");
  }

  const leaseOwner = randomUUID();
  let port: BackgroundPort | undefined;
  const requirePort = (): BackgroundPort => {
    if (!port) throw new Error("Фоновые задачи не подключены к службе чата: передайте их в createChatServer — ядро вызовет attach");
    return port;
  };

  function plan(record: TaskRecord): TaskPlan {
    if (record.kind === "tool") {
      const definition = tools[record.name];
      if (!definition) return `Фонового инструмента «${record.name}» больше нет в настройках службы`;
      return {
        work: (task, control) => runBackgroundTool(definition, task, control),
        rerunAfterRestart: definition.rerunAfterRestart === true,
        timeoutMs: definition.timeoutMs ?? timeoutMs,
      };
    }
    const helper = backgroundHelpers(port)[record.name];
    if (!helper) return `Фонового помощника «${record.name}» больше нет в настройках службы`;
    return { work: (task, control) => runHelperTask(requirePort(), helper, task, control), rerunAfterRestart: true, timeoutMs };
  }

  const delivery = createTaskDelivery({ store, leaseOwner, port: requirePort });
  const runner = createTaskRunner({ store, leaseOwner, leaseMs, port: requirePort, delivery, plan });
  const service = { store, maxRunningPerUser, runner: () => (requirePort(), runner) };

  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let recovering = false;
  let renewing: Promise<void> | undefined;
  let sweeping: Promise<void> | undefined;

  /**
   * Обход по таймеру: продлить аренды; отдельно — повторить недоставленное и, после `recover`, подобрать брошенные
   * задачи. Продление не ждёт доставки и подбора: на медленной базе они идут дольше аренды.
   */
  function tick(): void {
    renewing ??= runner.renewLeases().finally(() => {
      renewing = undefined;
    });
    sweeping ??= (async () => {
      await delivery.retryPending();
      if (recovering) await runner.recoverExpired().catch((error: unknown) => port?.logError(error));
    })().finally(() => {
      sweeping = undefined;
    });
  }

  return {
    instructions: backgroundInstructions(maxRunningPerUser),
    get toolNames() {
      return [...Object.keys(tools), ...Object.keys(backgroundHelpers(port)).map((name) => HELPER_TOOL_PREFIX + name), CHECK_TASKS, CANCEL_TASK];
    },
    tools(model) {
      const set: ToolSet = {};
      for (const [name, definition] of Object.entries(tools)) set[name] = backgroundToolForTurn(name, definition, model, service);
      for (const [name, helper] of Object.entries(backgroundHelpers(port))) set[HELPER_TOOL_PREFIX + name] = helperToolForTurn(name, helper, model, service);
      return { ...set, ...taskToolsForTurn(model, service) };
    },
    attach(attached) {
      if (port) throw new Error("Фоновые задачи уже подключены к службе чата: один экземпляр — одна служба");
      port = attached;
      unsubscribe = attached.events.subscribe((event) => {
        if (event.type === "turn-finished") delivery.chatFree(event.ownerId, event.chatId);
      });
      timer = setInterval(tick, Math.floor(leaseMs / 3));
      timer.unref?.();
    },
    async listForChat(ownerId, chatId) {
      return (await store.listForChat(ownerId, chatId)).map(viewOf);
    },
    async start(request) {
      return startFromApp(request, { tools, port: requirePort(), runner, maxRunningPerUser });
    },
    cancel: (ownerId, chatId, taskId) => service.runner().cancel(ownerId, chatId, taskId, "human"),
    answerApproval: (ownerId, chatId, taskId, approvalId, decision) => service.runner().answerApproval(ownerId, chatId, taskId, approvalId, decision, maxRunningPerUser),
    chatDeleted: (ownerId, chatId) => service.runner().chatDeleted(ownerId, chatId),
    async recover() {
      requirePort();
      recovering = true;
      await runner.recoverExpired();
    },
    async flush() {
      clearInterval(timer);
      unsubscribe?.();
      recovering = false;
      await Promise.all([renewing, sweeping]);
      await runner.stop();
      await delivery.idle();
    },
  };
}

function checkOptions(tools: Record<string, BackgroundToolDefinition>, maxRunningPerUser: number, timeoutMs: number, leaseMs: number): void {
  if (!Number.isInteger(maxRunningPerUser) || maxRunningPerUser < 1) throw new Error("Фоновые задачи: maxRunningPerUser — целое число от 1");
  if (!(timeoutMs > 0)) throw new Error("Фоновые задачи: timeoutMs — больше нуля");
  if (!(leaseMs >= MIN_LEASE_MS)) throw new Error(`Фоновые задачи: leaseMs — не меньше ${MIN_LEASE_MS} мс`);
  for (const [name, definition] of Object.entries(tools)) {
    if (!TOOL_NAME.test(name)) throw new Error(`Фоновый инструмент «${name}»: имя — латиница, цифры, «_» и «-», до 64 знаков`);
    if (name === CHECK_TASKS || name === CANCEL_TASK || name.startsWith(HELPER_TOOL_PREFIX)) {
      throw new Error(`Фоновый инструмент «${name}»: имя занято инструментами фона или помощников`);
    }
    if (definition.timeoutMs !== undefined && !(definition.timeoutMs > 0)) throw new Error(`Фоновый инструмент «${name}»: timeoutMs — больше нуля`);
  }
}

function viewOf(task: TaskRecord): TaskView {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    name: task.name,
    status: task.status,
    startedAt: task.startedAt ?? task.createdAt,
    ...(task.finishedAt && { finishedAt: task.finishedAt }),
    ...(task.progress && { progress: task.progress }),
  };
}
