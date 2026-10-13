import type { ModelMessage } from "ai";
import type { AgentChatMessage } from "../conversation/types";
import { HELPER_TOOL_PREFIX } from "./helper-tools";
import type { HelperPendingApproval, HelperProgress } from "./helper-types";

type MessagePart = AgentChatMessage["parts"][number];

/** Решение человека по подтверждению внутри помощника. */
export interface HelperDecision {
  approvalId: string;
  approved: boolean;
  reason?: string;
}

/**
 * Что нужно, чтобы досчитать помощника после паузы: его сообщения до запроса подтверждения и, когда человек ответил,
 * решение. Лежит в результате части `helper_<имя>` только пока помощник не закончил.
 */
export interface HelperResume {
  messages: ModelMessage[];
  decision?: HelperDecision;
}

/** Результат части `helper_<имя>`: вид для человека и, пока помощник стоит, данные для продолжения. */
export type HelperPartOutput = HelperProgress & { resume?: HelperResume };

interface HelperPartView {
  type: string;
  toolName?: string;
  toolCallId: string;
  state?: string;
  input?: { task?: string };
  output?: HelperPartOutput;
}

const TYPE_PREFIX = `tool-${HELPER_TOOL_PREFIX}`;

/** Имя помощника части `helper_<имя>` с результатом; не часть помощника — `undefined`. */
export function helperNameOfPart(part: MessagePart): string | undefined {
  const view = part as HelperPartView;
  if (view.state !== "output-available" || typeof view.output?.status !== "string") return undefined;
  if (part.type.startsWith(TYPE_PREFIX)) return part.type.slice(TYPE_PREFIX.length);
  if (part.type === "dynamic-tool" && view.toolName?.startsWith(HELPER_TOOL_PREFIX)) return view.toolName.slice(HELPER_TOOL_PREFIX.length);
  return undefined;
}

const outputOf = (part: MessagePart): HelperPartOutput | undefined =>
  helperNameOfPart(part) === undefined ? undefined : (part as HelperPartView).output;

/** Подтверждение, которого помощник в этой части ждёт от человека; ответа ещё нет. */
export function helperPendingApproval(part: MessagePart): HelperPendingApproval | undefined {
  const output = outputOf(part);
  return output?.status === "awaiting_approval" && output.resume && !output.resume.decision ? output.pendingApproval : undefined;
}

/** Часть с отмеченным решением: помощник «работает» до продолжения хода, запрос снят. */
export function recordHelperDecision(part: MessagePart, decision: HelperDecision): MessagePart {
  const { pendingApproval: _pending, resume, ...rest } = outputOf(part)!;
  return { ...part, output: { ...rest, status: "running", resume: { messages: resume!.messages, decision } } } as MessagePart;
}

/**
 * Помощник, который стоит на подтверждении или ждёт продолжения после ответа, закрыт сбоем: ход дальше не пойдёт.
 * `reason` — запрос без ответа, `allowedReason` — разрешённый, но не досчитанный; отклонённый — с причиной отказа.
 * Прочие части — как есть.
 */
export function closeWaitingHelper(part: MessagePart, reason: string, allowedReason: string = reason): MessagePart {
  const output = outputOf(part);
  if (!output?.resume) return part;
  const { pendingApproval: _pending, resume, ...rest } = output;
  const decision = resume.decision;
  const error = !decision ? reason : decision.approved ? allowedReason : (decision.reason ?? reason);
  return { ...part, output: { ...rest, status: "failed", error } } as MessagePart;
}

/** Помощник, которого надо досчитать перед основным циклом: решение есть, сообщения для продолжения — с ответом. */
export interface HelperToContinue {
  toolCallId: string;
  name: string;
  task: string;
  messages: ModelMessage[];
}

export function helpersToContinue(parts: readonly MessagePart[]): HelperToContinue[] {
  const found: HelperToContinue[] = [];
  for (const part of parts) {
    const name = helperNameOfPart(part);
    const output = outputOf(part);
    const decision = output?.resume?.decision;
    if (name === undefined || !output || output.status !== "running" || !decision) continue;
    const response = {
      type: "tool-approval-response" as const,
      approvalId: decision.approvalId,
      approved: decision.approved,
      ...(decision.reason && { reason: decision.reason }),
    };
    found.push({
      toolCallId: (part as HelperPartView).toolCallId,
      name,
      task: output.task,
      messages: [...output.resume!.messages, { role: "tool", content: [response] }],
    });
  }
  return found;
}
