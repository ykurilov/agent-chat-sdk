import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskStatusView } from "../skin-contract";

/** Задача, как её отдаёт `GET {chat}/tasks`. */
export interface BackgroundTask {
  id: string;
  title: string;
  kind: string;
  name: string;
  status: TaskStatusView;
  startedAt: string;
  finishedAt?: string;
  progress?: unknown;
}

/** Решение человека по задаче, которая ждёт подтверждения. */
export type TaskApprovalDecision = "allow" | "deny";
export type TaskDecisionState = { state: "pending" } | { state: "failed" } | { state: "decided"; decision: TaskApprovalDecision };

export interface UseBackgroundTasksOptions {
  /** Адрес чата: `{api}/{chatId}`. */
  chatUrl: string;
  /** Скин показывает карточки или плашки, история загружена. Нет — задачи не запрашиваются. */
  enabled: boolean;
  /** Растёт, когда список мог измениться (подписка открылась, пришло `tasks-changed`): список перечитывается. */
  version: number;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface BackgroundTasks {
  /** Задачи чата; пусто, пока не загружены или у сервера фона нет. */
  tasks: readonly BackgroundTask[];
  /** Текущее время для «сколько идёт»: тикает раз в секунду, пока есть живые задачи. */
  now: number;
  cancel: (taskId: string) => Promise<void>;
  cancelingIds: ReadonlySet<string>;
  /** Ответ на вопрос `approvalId` задачи: ответ на вопрос, который задача уже не задаёт, сервер не примет. */
  decide: (taskId: string, approvalId: string, decision: TaskApprovalDecision) => Promise<void>;
  /** Решения по номеру вопроса: у одной задачи вопросов бывает несколько. */
  decisions: Readonly<Record<string, TaskDecisionState>>;
}

// Один пустой список на все вызовы: новый `[]` на каждой отрисовке перерисовывал бы ленту.
const NO_TASKS: readonly BackgroundTask[] = [];
const LIVE_STATUSES: ReadonlySet<TaskStatusView> = new Set(["queued", "running", "awaiting_approval"]);
export const isLiveTask = (task: BackgroundTask) => LIVE_STATUSES.has(task.status);

/** Номер вопроса, ответа на который задача ждёт сейчас (`progress.pendingApproval.approvalId`). */
export function pendingApprovalIdOf(task: BackgroundTask): string | undefined {
  const approvalId = (task.progress as { pendingApproval?: { approvalId?: unknown } } | undefined)?.pendingApproval?.approvalId;
  return typeof approvalId === "string" ? approvalId : undefined;
}

/** Сколько идёт (или шла) задача к моменту `now`. */
export function taskElapsedMs(task: BackgroundTask, now: number): number {
  const started = Date.parse(task.startedAt);
  const until = task.finishedAt ? Date.parse(task.finishedAt) : now;
  return Number.isFinite(started) && Number.isFinite(until) ? Math.max(0, until - started) : 0;
}

/**
 * Фоновые задачи чата: список с сервера, отмена и решение по подтверждению. Сервер без фона (404) — задач нет,
 * повторных запросов тоже.
 */
export function useBackgroundTasks({ chatUrl, enabled, version, fetch: customFetch }: UseBackgroundTasksOptions): BackgroundTasks {
  const fetchRef = useRef(customFetch);
  fetchRef.current = customFetch;
  const send = useCallback((url: string, init?: RequestInit) => (fetchRef.current ?? globalThis.fetch)(url, init), []);
  const [loaded, setLoaded] = useState<{ chatUrl: string; tasks: readonly BackgroundTask[] } | null>(null);
  const [reread, setReread] = useState(0);
  const unavailableFor = useRef<string | null>(null);
  const [cancelingIds, setCancelingIds] = useState<ReadonlySet<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, TaskDecisionState>>({});

  useEffect(() => {
    if (!enabled || unavailableFor.current === chatUrl) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await send(`${chatUrl}/tasks`, { signal: controller.signal });
        if (response.status === 404) {
          unavailableFor.current = chatUrl;
          return;
        }
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (!controller.signal.aborted && Array.isArray(body)) setLoaded({ chatUrl, tasks: body as BackgroundTask[] });
      } catch {
        // Нет связи — список остаётся прежним до следующего повода перечитать.
      }
    })();
    return () => controller.abort();
  }, [chatUrl, enabled, reread, send, version]);

  useEffect(() => {
    setCancelingIds(new Set());
    setDecisions({});
  }, [chatUrl]);

  const tasks = loaded?.chatUrl === chatUrl ? loaded.tasks : NO_TASKS;
  const anyLive = tasks.some(isLiveTask);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyLive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyLive]);

  const cancel = useCallback(
    async (taskId: string) => {
      setCancelingIds((current) => new Set(current).add(taskId));
      try {
        await send(`${chatUrl}/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
      } catch {
        // Отмена не дошла — кнопка снова доступна.
      }
      setCancelingIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
      setReread((count) => count + 1);
    },
    [chatUrl, send],
  );

  const decide = useCallback(
    async (taskId: string, approvalId: string, decision: TaskApprovalDecision) => {
      setDecisions((current) => ({ ...current, [approvalId]: { state: "pending" } }));
      let accepted = false;
      try {
        const response = await send(`${chatUrl}/tasks/${encodeURIComponent(taskId)}/approval`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, approvalId }),
        });
        accepted = response.ok;
      } catch {
        accepted = false;
      }
      setDecisions((current) => ({ ...current, [approvalId]: accepted ? { state: "decided", decision } : { state: "failed" } }));
      setReread((count) => count + 1);
    },
    [chatUrl, send],
  );

  return { tasks, now, cancel, cancelingIds, decide, decisions };
}
