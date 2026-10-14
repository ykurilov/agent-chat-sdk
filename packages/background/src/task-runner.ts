import { randomUUID } from "node:crypto";
import type { BackgroundPort, TaskStatus } from "@ykurilov/agent-chat-core";
import { createKeyedLock } from "./keyed-lock";
import { isFinishedStatus, isRunningStatus, RUNNING_STATUSES } from "./store/task-store";
import type { TaskDelivery } from "./task-delivery";
import type { TaskCondition, TaskPatch, TaskRecord, TaskStore } from "./types";

/** Сколько раз задачу запускают заново после падений сервера; дальше — «прервана». */
const MAX_ATTEMPTS = 3;

/** Что можно отменить: задача идёт или ждёт решения человека. */
const CANCELABLE_STATUSES = [...RUNNING_STATUSES, "awaiting_approval"] as const satisfies readonly TaskStatus[];

/** Чем закончился запуск: статус и поля итога. */
export type TaskOutcome = TaskPatch & { status: TaskStatus };

/** Что запуск задачи получает от бегунка. */
export interface RunControl {
  signal: AbortSignal;
  /** Короткий текст хода в карточке; частые вызовы не копят записи. */
  reportProgress(text: string): void;
  /** Сохранить шаг (помощник); аренду проверяет перед записью, потерянная аренда обрывает запуск. */
  saveStep(patch: TaskPatch): Promise<void>;
}

/** Как вести задачу; строка — почему её вести нельзя (описания больше нет в настройках). */
export type TaskPlan = { work(record: TaskRecord, control: RunControl): Promise<TaskOutcome>; rerunAfterRestart: boolean; timeoutMs: number } | string;

/** Новая задача из вызова инструмента. */
export type NewTask = Pick<TaskRecord, "ownerId" | "chatId" | "messageId" | "toolCallId" | "channel" | "kind" | "name" | "input" | "title">;

interface RunningTask {
  record: TaskRecord;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  /** Итог уже пишется (готово, ошибка, таймаут): второй итог не нужен. */
  finishing: boolean;
  /** Запуск остановлен снаружи (отмена, потеря аренды, остановка службы): итог не пишется. */
  stopped: boolean;
}

/** Аренда, которую держит эта копия: задача идёт здесь или ждёт здесь доставки итога. */
interface HeldLease {
  ownerId: string;
  chatId: string;
  run?: RunningTask;
}

export interface TaskRunner {
  start(task: NewTask, maxRunningPerUser: number): Promise<{ status: "started"; taskId: string } | { status: "too_many_tasks" }>;
  cancel(ownerId: string, chatId: string, taskId: string, by: "human" | "agent"): Promise<"canceled" | "not_found" | "already_finished">;
  answerApproval(ownerId: string, chatId: string, taskId: string, approvalId: string, decision: "allow" | "deny"): Promise<"resumed" | "not_found" | "stale">;
  chatDeleted(ownerId: string, chatId: string): Promise<void>;
  /** Подобрать задачи, чья аренда истекла: хозяин пропал. */
  recoverExpired(): Promise<void>;
  renewLeases(): Promise<void>;
  /** Остановить запуски без записи итога и отпустить аренды: следующий старт подберёт задачи сразу. */
  stop(): Promise<void>;
}

/**
 * Бегунок задач. Задача идёт у той копии сервера, что держит аренду; аренда продлевается по таймеру службы. Итог
 * пишется, только если аренда ещё наша. Переходы одной задачи (итог, отмена, ответ на подтверждение) идут по одному.
 */
export function createTaskRunner(deps: {
  store: TaskStore;
  leaseOwner: string;
  leaseMs: number;
  port(): BackgroundPort;
  delivery: TaskDelivery;
  plan(record: TaskRecord): TaskPlan;
}): TaskRunner {
  const { store, leaseOwner: me, leaseMs, delivery } = deps;
  const leases = new Map<string, HeldLease>();
  const taskLock = createKeyedLock();
  const ownerLock = createKeyedLock();
  /** Служба остановлена: брошенные задачи не подбираем, новых запусков нет. */
  let stopped = false;
  let recovering: Promise<void> | undefined;
  const now = () => new Date().toISOString();
  const leaseUntil = (from: string) => new Date(Date.parse(from) + leaseMs).toISOString();
  /** Запись идущей задачи: только пока аренда у этой копии и задача идёт — отмену или чужой итог она не затрёт. */
  const stillMine: TaskCondition = { leaseOwner: me, statuses: RUNNING_STATUSES };
  const tasksChanged = (ownerId: string, chatId: string) => deps.port().events.emit({ type: "tasks-changed", ownerId, chatId });
  const logError = (error: unknown) => deps.port().logError(error);

  function stopRun(run: RunningTask, reason: string): void {
    run.stopped = true;
    run.finishing = true;
    clearTimeout(run.timer);
    run.controller.abort(new Error(reason));
  }

  /** Итог задачи, которую ведёт эта копия: запись, событие, доставка. Задачу забрали или отменили — итог не наш. */
  async function writeOutcome(record: TaskRecord, outcome: TaskOutcome): Promise<void> {
    const at = now();
    const patch: TaskPatch = { ...outcome, ...(isFinishedStatus(outcome.status) && { finishedAt: at }), leaseUntil: leaseUntil(at) };
    if (!(await store.update(record.ownerId, record.id, patch, stillMine))) {
      leases.delete(record.id);
      return;
    }
    leases.set(record.id, { ownerId: record.ownerId, chatId: record.chatId });
    tasksChanged(record.ownerId, record.chatId);
    void delivery.request(record.ownerId, record.chatId);
  }

  async function finish(run: RunningTask, outcome: TaskOutcome): Promise<void> {
    if (run.finishing) return;
    run.finishing = true;
    clearTimeout(run.timer);
    if (outcome.status === "timed_out") run.controller.abort(new Error(outcome.error));
    await taskLock(run.record.id, async () => {
      if (run.stopped) return;
      try {
        await writeOutcome(run.record, outcome);
      } catch (error) {
        // Аренду не держим: задачу подберёт восстановление.
        leases.delete(run.record.id);
        logError(error);
      }
    });
  }

  function progressWriter(run: RunningTask): (text: string) => void {
    let latest: string | undefined;
    let writing = false;
    return (text) => {
      latest = text;
      if (writing) return;
      writing = true;
      void (async () => {
        try {
          while (latest !== undefined && !run.finishing) {
            const next = latest;
            latest = undefined;
            const progress = { task: run.record.title, steps: [], text: next, status: "running" as const };
            if (await store.update(run.record.ownerId, run.record.id, { progress }, stillMine)) tasksChanged(run.record.ownerId, run.record.chatId);
          }
        } catch (error) {
          logError(error);
        } finally {
          writing = false;
        }
      })();
    };
  }

  /** Запуск задачи, которую эта копия только что взяла (`claim`). */
  function launch(record: TaskRecord, plan: Exclude<TaskPlan, string>): void {
    const run: RunningTask = { record, controller: new AbortController(), finishing: false, stopped: false };
    leases.set(record.id, { ownerId: record.ownerId, chatId: record.chatId, run });
    run.timer = setTimeout(() => void finish(run, { status: "timed_out", error: `Задача не уложилась в ${formatDuration(plan.timeoutMs)}` }), plan.timeoutMs);
    run.timer.unref?.();
    const control: RunControl = {
      signal: run.controller.signal,
      reportProgress: progressWriter(run),
      async saveStep(patch) {
        if (run.finishing) return;
        if (!(await store.update(record.ownerId, record.id, { ...patch, leaseUntil: leaseUntil(now()) }, stillMine))) {
          leases.delete(record.id);
          stopRun(run, "аренда задачи потеряна");
          throw run.controller.signal.reason;
        }
        tasksChanged(record.ownerId, record.chatId);
      },
    };
    void Promise.resolve()
      .then(() => plan.work(record, control))
      .then(
        (outcome) => finish(run, outcome),
        (error: unknown) => finish(run, { status: "failed", error: messageOf(error) }),
      );
  }

  /** Задача без запуска получает итог сразу (прервана, описания нет). */
  async function finishWithout(record: TaskRecord, outcome: TaskOutcome): Promise<void> {
    await taskLock(record.id, () => writeOutcome(record, outcome));
  }

  /** Обход брошенных задач. На медленной базе он идёт долго: аренда каждой задачи считается от её взятия. */
  async function recoverOnce(): Promise<void> {
    for (const stale of await store.listExpired(now())) {
      if (stopped) return;
      if (leases.has(stale.id)) continue;
      try {
        const at = now();
        const claimed = await store.claim(stale.id, me, leaseUntil(at), at);
        if (claimed) await resume(stale.status, claimed);
      } catch (error) {
        logError(error);
      }
    }
  }

  async function resume(prior: TaskStatus, claimed: TaskRecord): Promise<void> {
    if (!isRunningStatus(prior)) {
      // Итог готов, но не доставлен: доставит эта копия.
      leases.set(claimed.id, { ownerId: claimed.ownerId, chatId: claimed.chatId });
      await delivery.request(claimed.ownerId, claimed.chatId);
      return;
    }
    const plan = deps.plan(claimed);
    if (typeof plan === "string") return finishWithout(claimed, { status: "failed", error: plan });
    if (claimed.attempt > MAX_ATTEMPTS) return finishWithout(claimed, { status: "interrupted" });
    // Не начатую задачу запускаем всегда; начатую — если её можно повторить.
    if (prior === "running" && !plan.rerunAfterRestart) return finishWithout(claimed, { status: "interrupted" });
    launch(claimed, plan);
    tasksChanged(claimed.ownerId, claimed.chatId);
  }

  return {
    start(task, maxRunningPerUser) {
      // По одному на человека: одновременные вызовы не обойдут предел.
      return ownerLock(task.ownerId, async () => {
        if ((await store.countActive(task.ownerId)) >= maxRunningPerUser) return { status: "too_many_tasks" as const };
        const plan = deps.plan({ ...task, id: "", status: "queued", attempt: 0, createdAt: "" });
        if (typeof plan === "string") throw new Error(plan);
        const createdAt = now();
        const id = randomUUID();
        await store.create({ ...task, id, status: "queued", attempt: 0, createdAt, leaseOwner: me, leaseUntil: leaseUntil(createdAt) });
        const claimed = await store.claim(id, me, leaseUntil(createdAt), createdAt);
        if (!claimed) throw new Error(`Задача ${id} не взята в работу сразу после создания`);
        launch(claimed, plan);
        tasksChanged(task.ownerId, task.chatId);
        return { status: "started" as const, taskId: id };
      });
    },

    cancel(ownerId, chatId, taskId, by) {
      return taskLock(taskId, async () => {
        const task = await store.get(ownerId, taskId);
        if (!task || task.chatId !== chatId) return "not_found";
        if (isFinishedStatus(task.status)) return "already_finished";
        const at = now();
        const canceled: TaskPatch =
          by === "human"
            ? // Пометка «отменена» в чате: доставит эта копия, агент не проснётся.
              { status: "canceled", finishedAt: at, leaseOwner: me, leaseUntil: leaseUntil(at), deliveredAt: undefined, deliveryKey: undefined }
            : // Отменил сам агент: он и так знает, сообщать нечего.
              { status: "canceled", finishedAt: at, deliveredAt: at, leaseOwner: undefined, leaseUntil: undefined, deliveryKey: undefined };
        // Итог мог записаться на другой копии между чтением и записью: тогда задача уже закончена.
        if (!(await store.update(ownerId, taskId, canceled, { statuses: CANCELABLE_STATUSES }))) return "already_finished";
        const run = leases.get(taskId)?.run;
        if (run) stopRun(run, "задача отменена");
        if (by === "human") {
          leases.set(taskId, { ownerId, chatId });
          void delivery.request(ownerId, chatId);
        } else {
          leases.delete(taskId);
        }
        tasksChanged(ownerId, chatId);
        return "canceled";
      });
    },

    answerApproval(ownerId, chatId, taskId, approvalId, decision) {
      return taskLock(taskId, async () => {
        const task = await store.get(ownerId, taskId);
        const pending = task?.progress?.pendingApproval;
        if (!task || task.chatId !== chatId || task.status !== "awaiting_approval" || !pending) return "not_found";
        // Ответ на вопрос, который помощник уже не задаёт (опоздал, пока шёл новый шаг), новый вопрос не одобряет.
        if (pending.approvalId !== approvalId) return "stale";
        const plan = deps.plan(task);
        if (typeof plan === "string") return "not_found";
        const { pendingApproval: _answered, ...progress } = task.progress!;
        const response = { type: "tool-approval-response" as const, approvalId, approved: decision === "allow" };
        // Продолжение по решению человека — не новая попытка: попытки считают только перезапуски после сбоев.
        // Условие по статусу и вопросу: ответ, пришедший сразу на две копии, продолжит задачу один раз, а пока
        // эта копия писала, другая могла ответить и помощник — задать новый вопрос.
        const resumed = await store.update(
          ownerId,
          taskId,
          {
            status: "running",
            helperMessages: [...(task.helperMessages ?? []), { role: "tool", content: [response] }],
            progress: { ...progress, status: "running" },
            deliveredAt: undefined,
            deliveryKey: undefined,
            leaseOwner: me,
            leaseUntil: leaseUntil(now()),
          },
          { statuses: ["awaiting_approval"], pendingApprovalId: approvalId },
        );
        if (!resumed) return (await store.get(ownerId, taskId))?.status === "awaiting_approval" ? "stale" : "not_found";
        launch(resumed, plan);
        tasksChanged(ownerId, chatId);
        return "resumed";
      });
    },

    async chatDeleted(ownerId, chatId) {
      for (const [taskId, lease] of leases) {
        if (lease.ownerId !== ownerId || lease.chatId !== chatId) continue;
        if (lease.run) stopRun(lease.run, "чат удалён");
        leases.delete(taskId);
      }
      delivery.forget(ownerId, chatId);
      // Другие копии потеряют продление аренды и сами оборвут свои запуски.
      await store.deleteForChat(ownerId, chatId);
    },

    recoverExpired() {
      // Один обход за раз: второй, начатый посреди первого, взял бы ту же задачу (своя аренда берётся снова) и запустил дважды.
      recovering ??= recoverOnce().finally(() => {
        recovering = undefined;
      });
      return recovering;
    },

    async renewLeases() {
      const until = leaseUntil(now());
      await Promise.all(
        [...leases].map(async ([taskId, lease]) => {
          let renewed: boolean;
          try {
            renewed = await store.renewLease(taskId, me, until);
          } catch (error) {
            logError(error);
            return;
          }
          // Не продлилась: итог доставлен или задачу забрала другая копия (она её и ведёт).
          if (renewed || leases.get(taskId) !== lease) return;
          leases.delete(taskId);
          if (lease.run) stopRun(lease.run, "аренда задачи потеряна");
        }),
      );
    },

    async stop() {
      stopped = true;
      const held = [...leases.entries()];
      leases.clear();
      for (const [, lease] of held) if (lease.run) stopRun(lease.run, "служба остановлена");
      const at = now();
      await Promise.all(held.map(([taskId]) => store.renewLease(taskId, me, at).catch(logError)));
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDuration(ms: number): string {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} мин` : `${Math.ceil(ms / 1000)} с`;
}
