import type { AgentChatMessage } from "../chat-types";
import type { NoticeLabels } from "../labels";
import type { AgentNoticeViewKind, AgentNoticeViewProps } from "../skin-contract";
import { pendingApprovalIdOf } from "../background-tasks/use-background-tasks";
import type { BackgroundTask, TaskApprovalDecision, TaskDecisionState } from "../background-tasks/use-background-tasks";

/** Служебное сообщение, как его пишет сервер в часть `data-agent-notice`. */
export interface AgentNotice {
  kind: AgentNoticeViewKind;
  taskId?: string;
  title: string;
  result?: string;
  error?: string;
  approval?: { approvalId: string; toolName: string; input: unknown };
}

export const AGENT_NOTICE_PART_TYPE = "data-agent-notice";

/** Служебные сообщения из сообщения человека, кроме реплик сотрудника; пусто — это обычное сообщение или реплика. */
export function agentNoticesOf(message: AgentChatMessage): AgentNotice[] {
  return rawNoticesOf(message).filter((notice) => notice.kind !== STAFF_NOTICE_KIND) as AgentNotice[];
}

/** Реплика живого сотрудника человеку (служебное сообщение вида `staff`, с 0.53). */
export interface StaffReply {
  text: string;
  staffName?: string;
}

const STAFF_NOTICE_KIND = "staff";

/** Реплики сотрудника из сообщения; пусто — их нет. */
export function staffRepliesOf(message: AgentChatMessage): StaffReply[] {
  return rawNoticesOf(message)
    .filter((notice) => notice.kind === STAFF_NOTICE_KIND)
    .map((notice) => {
      const { title, staffName } = notice as { title?: unknown; staffName?: unknown };
      return { text: typeof title === "string" ? title : "", ...(typeof staffName === "string" && staffName && { staffName }) };
    });
}

function rawNoticesOf(message: AgentChatMessage): Array<{ kind: string }> {
  if (message.role !== "user") return [];
  return message.parts.flatMap((part) => {
    if (part.type !== AGENT_NOTICE_PART_TYPE) return [];
    const notices = (part as { data?: { notices?: unknown } }).data?.notices;
    return Array.isArray(notices) ? (notices.filter(isAgentNotice) as Array<{ kind: string }>) : [];
  });
}

function isAgentNotice(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && typeof (value as { kind?: unknown }).kind === "string";
}

export interface NoticeTaskControls {
  tasks: readonly BackgroundTask[];
  decisions: Readonly<Record<string, TaskDecisionState>>;
  decide: (taskId: string, approvalId: string, decision: TaskApprovalDecision) => void;
  failureText: string;
}

/**
 * Вид плашки. У `conversation_started` заголовок пустой: это указание агенту от приложения, человеку его не показывают.
 * Кнопки решения — только пока задача в списке и ждёт ответа на вопрос этой плашки; после решения — отметка.
 */
export function noticeViewOf(notice: AgentNotice, controls: NoticeTaskControls): AgentNoticeViewProps {
  const view: AgentNoticeViewProps = { kind: notice.kind, title: notice.kind === "conversation_started" ? "" : notice.title };
  if (notice.result) view.result = notice.result;
  if (notice.error) view.errorText = notice.error;
  if (notice.kind !== "task_awaiting_approval" || !notice.taskId) return view;
  const taskId = notice.taskId;
  const task = controls.tasks.find((item) => item.id === taskId);
  const approvalId = notice.approval?.approvalId ?? (task && pendingApprovalIdOf(task));
  if (!approvalId) return view;
  const decision = controls.decisions[approvalId];
  if (decision?.state === "decided") return { ...view, approval: { state: decision.decision === "allow" ? "allowed" : "denied" } };
  // Задача уже задала новый вопрос — у плашки старого кнопок нет.
  const waiting = task?.status === "awaiting_approval" && (pendingApprovalIdOf(task) ?? approvalId) === approvalId;
  if (!waiting) return view;
  return {
    ...view,
    approval: {
      state: "requested",
      // «Всегда» у задачи нет: решение касается одного вызова фоновой задачи.
      onDecide: (choice) => controls.decide(taskId, approvalId, choice === "deny" ? "deny" : "allow"),
      pending: decision?.state === "pending",
      failed: decision?.state === "failed",
      ...(decision?.state === "failed" && { failureText: controls.failureText }),
      canAlways: false,
    },
  };
}

const statusLabel: Record<AgentNoticeViewKind, keyof Omit<NoticeLabels, "line" | "staffSaid">> = {
  task_done: "taskDone",
  task_failed: "taskFailed",
  task_canceled: "taskCanceled",
  task_interrupted: "taskInterrupted",
  task_timed_out: "taskTimedOut",
  task_awaiting_approval: "taskAwaitingApproval",
  conversation_started: "conversationStarted",
};

/** Служебные сообщения короткими строками — для скина без `AgentNoticeView`. Указание агенту (`conversation_started`) не видно. */
export function noticesAsText(notices: readonly AgentNotice[], labels: NoticeLabels): string {
  return notices
    .map((notice) => {
      const status = labels[statusLabel[notice.kind]] ?? notice.kind;
      return labels.line(notice.kind === "conversation_started" ? "" : notice.title, status);
    })
    .join("\n");
}
