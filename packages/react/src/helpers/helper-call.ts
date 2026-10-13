import { getToolName } from "ai";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ApprovalDecision, ApprovalFailureKind } from "../chat-types";
import type { HelperCallStatus, HelperCallView, HelperStepView, ToolApprovalView } from "../skin-contract";

/*
 * Клиентские копии типов помощника из ядра: ядро браузеру не нужно, форма совпадает с `@ykurilov/agent-chat-core`.
 */

/** Шаг помощника: вызов его инструмента или кусок текста. */
export type HelperStep = { type: "tool"; toolName: string; input: unknown; output?: unknown; error?: string } | { type: "text"; text: string };

/** Ход помощника, как его пишет сервер в вывод вызова `helper_*` (в том числе промежуточный). */
export interface HelperProgress {
  task: string;
  steps: HelperStep[];
  text: string;
  status: "running" | "awaiting_approval" | "done" | "failed" | "background";
  pendingApproval?: { approvalId: string; toolName: string; title?: string; input: unknown };
  taskId?: string;
  error?: string;
  /** Только на экране: решение человека по подтверждению помощника, пока сервер не прислал продолжение. */
  decided?: "allowed" | "always" | "denied";
}

/** Приставка имени инструмента-помощника; часть протокола, слово не менять. */
export const HELPER_TOOL_PREFIX = "helper_";

type ToolPart = ToolUIPart | DynamicToolUIPart;

export const isHelperToolName = (name: string) => name.startsWith(HELPER_TOOL_PREFIX);

export const isHelperPart = (part: ToolPart) => isHelperToolName(getToolName(part));

/** Ход помощника из вывода вызова; нет вывода или он чужой формы — `undefined`. */
export function helperProgressOf(part: { output?: unknown }): HelperProgress | undefined {
  const output = part.output;
  if (typeof output !== "object" || output === null) return undefined;
  const progress = output as Partial<HelperProgress>;
  return typeof progress.status === "string" && Array.isArray(progress.steps) ? (output as HelperProgress) : undefined;
}

/** Id запроса подтверждения внутри помощника, который ждёт человека. */
export function pendingHelperApprovalId(part: { output?: unknown }): string | undefined {
  const progress = helperProgressOf(part);
  return progress?.status === "awaiting_approval" ? progress.pendingApproval?.approvalId : undefined;
}

export interface HelperCallControls {
  onApproval: (approvalId: string, decision: ApprovalDecision) => void;
  approvalPendingId: string | null;
  approvalFailure: { id: string; kind: ApprovalFailureKind; text?: string } | null;
  failureText: (kind: ApprovalFailureKind) => string;
}

/** Что рисует `skin.HelperCallRow`, кроме раскрытия: имя без приставки, задание, шаги, итог, статус, подтверждение и его действие. */
export function helperCallViewOf(part: ToolPart, controls: HelperCallControls): Omit<HelperCallView, "open" | "onOpenChange"> {
  const progress = helperProgressOf(part as { output?: unknown });
  const input = part.input as { task?: unknown } | undefined;
  const task = progress?.task ?? (typeof input?.task === "string" ? input.task : "");
  const errorText = progress?.error ?? (part.state === "output-error" ? part.errorText : undefined);
  const approval = approvalOf(progress, controls);
  const approvalAction = approval?.state === "requested" ? approvalActionOf(progress!.pendingApproval!) : undefined;
  const title = (part as { title?: unknown }).title;
  return {
    name: getToolName(part).slice(HELPER_TOOL_PREFIX.length),
    ...(typeof title === "string" && title.length > 0 && { title }),
    task,
    steps: (progress?.steps ?? []).map(stepViewOf),
    text: progress?.text ?? "",
    status: statusOf(part, progress),
    ...(approval && { approval }),
    ...(approvalAction && { approvalAction }),
    ...(errorText && { errorText }),
  };
}

function approvalActionOf({ toolName, title, input }: NonNullable<HelperProgress["pendingApproval"]>): NonNullable<HelperCallView["approvalAction"]> {
  return { toolName, ...(title && { title }), ...(input !== undefined && { input }) };
}

function statusOf(part: ToolPart, progress: HelperProgress | undefined): HelperCallStatus {
  if (part.state === "output-error" || part.state === "output-denied") return "failed";
  if (progress) return progress.status;
  return part.state === "output-available" && !part.preliminary ? "done" : "running";
}

function stepViewOf(step: HelperStep, index: number): HelperStepView {
  const id = String(index);
  if (step.type === "text") return { kind: "text", id, text: step.text };
  return {
    kind: "tool",
    id,
    toolName: step.toolName,
    state: step.error !== undefined ? "error" : "output" in step ? "done" : "running",
    ...(step.input !== undefined && { input: step.input }),
    ...(step.output !== undefined && { output: step.output }),
    ...(step.error !== undefined && { errorText: step.error }),
  };
}

function approvalOf(progress: HelperProgress | undefined, controls: HelperCallControls): ToolApprovalView | undefined {
  if (progress?.decided) return { state: progress.decided };
  const approvalId = progress?.status === "awaiting_approval" ? progress.pendingApproval?.approvalId : undefined;
  if (!approvalId) return undefined;
  const failed = controls.approvalFailure?.id === approvalId ? controls.approvalFailure : undefined;
  const failure = failed?.kind;
  return {
    state: "requested",
    onDecide: (decision) => controls.onApproval(approvalId, decision),
    pending: controls.approvalPendingId === approvalId,
    failed: failure !== undefined,
    ...(failure !== undefined && { failureText: failed?.text ?? controls.failureText(failure) }),
    // «Всегда в этом чате» относится к инструментам основного агента; внутри помощника — только «да» или «нет».
    canAlways: false,
  };
}
