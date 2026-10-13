import type { AgentChatMessage } from "../conversation/types";
import { closeWaitingHelper, helperPendingApproval, recordHelperDecision } from "../helpers/helper-approval";
import { isPendingWidgetCall } from "../widgets/pending-widgets";

type MessagePart = AgentChatMessage["parts"][number];

/** Метка в `approval.reason`: решение «Всегда в этом чате». */
export const ALWAYS_IN_CHAT = "always-in-chat";
/**
 * Метка в `approval.requestReason` запроса: для этого вызова можно ответить «Всегда в этом чате».
 * Ставится только инструментам с простым флагом `needsApproval: true`; у функции решение зависит от входных данных, «всегда» ей не подходит.
 */
export const ALWAYS_OFFERED_REASON = "always-offered";
/** Что узнаёт модель, когда человек нажал «Отклонить». */
export const DENIED_BY_USER_REASON = "Пользователь отклонил это действие. Не повторяй его без нового запроса от пользователя.";
/** Что узнаёт модель, когда человек написал новое сообщение, не ответив на запрос. */
export const IGNORED_REASON = "Пользователь не ответил на запрос и написал новое сообщение. Не повторяй это действие без нового запроса.";
/** Что узнаёт модель, когда ход остановили или он упал, не дождавшись ответа. */
export const INTERRUPTED_REASON = "Ход прерван раньше, чем пользователь ответил на запрос. Действие не выполнялось.";
/** Что узнаёт модель, когда ход оборвался после «Разрешить», но результата нет: действие могло и выполниться. */
export const RESULT_UNKNOWN_REASON =
  "Пользователь разрешил действие, но ход прервался до результата. Неизвестно, выполнено оно или нет; не повторяй его, не проверив.";

/** Что узнаёт модель, когда вызов остался без результата: ход оборвался, действие могло выполниться частично или целиком. */
export const HANGING_TOOL_CALL_REASON =
  "Вызов инструмента оборвался до результата: действие могло выполниться частично или целиком. Не повторяй его, не проверив, что уже сделано";

/** Что узнаёт модель о вызове, который ждал очереди и был отменён до запуска (FR-049): действие не выполнялось. */
export const NOT_STARTED_TOOL_CALL_REASON = "Вызов отменён, пока ждал очереди: инструмент не запускался, действие не выполнялось.";

/** Часть вызова инструмента: то, что нужно знать о подтверждении. */
interface ToolPartView {
  type: string;
  toolName?: string;
  state?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
}

/** Запрос ждёт ответа и для него предложено «Всегда в этом чате». */
export function offersAlways(part: MessagePart): boolean {
  return (part as ToolPartView & { approval?: { requestReason?: string } }).approval?.requestReason === ALWAYS_OFFERED_REASON;
}

/** Ожидающая часть с этим запросом: вызов инструмента или помощник, который ждёт подтверждения внутри себя. */
export function pendingPartOf(parts: readonly MessagePart[], approvalId: string): MessagePart | undefined {
  return parts.find((part) => pendingApprovalOf(part)?.approvalId === approvalId);
}

export interface PendingApproval {
  approvalId: string;
  toolName: string;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

const isToolPart = (part: MessagePart): boolean => part.type.startsWith("tool-") || part.type === "dynamic-tool";

export function toolNameOfPart(part: MessagePart): string {
  const view = part as ToolPartView;
  return part.type === "dynamic-tool" ? (view.toolName ?? "") : part.type.slice("tool-".length);
}

const isPending = (part: MessagePart): boolean =>
  isToolPart(part) && (part as ToolPartView).state === "approval-requested" && Boolean((part as ToolPartView).approval?.id);

/** Запрос части без ответа. У помощника — запрос его инструмента: имя — инструмента помощника. */
function pendingApprovalOf(part: MessagePart): PendingApproval | undefined {
  if (isPending(part)) return { approvalId: (part as ToolPartView).approval!.id, toolName: toolNameOfPart(part) };
  const helper = helperPendingApproval(part);
  return helper && { approvalId: helper.approvalId, toolName: helper.toolName };
}

/** Запросы, на которые человек ещё не ответил. */
export function pendingApprovals(parts: readonly MessagePart[]): PendingApproval[] {
  return parts.flatMap((part) => pendingApprovalOf(part) ?? []);
}

const NO_WIDGETS: ReadonlySet<string> = new Set();

/**
 * Что ждёт человека: запросы подтверждения без ответа и вызовы ждущих виджетов (`widgetNames`) без результата. Пока
 * список не пуст, ход стоит со статусом `awaiting_approval`. Без виджетов — то же, что запросы подтверждения.
 */
export function pendingHumanInput(parts: readonly MessagePart[], widgetNames: ReadonlySet<string> = NO_WIDGETS): MessagePart[] {
  return parts.filter((part) => pendingApprovalOf(part) !== undefined || isPendingWidgetCall(part, widgetNames));
}

/** Части с отметкой решения у запроса `approvalId`; `null`, если такого ожидающего запроса нет. Исходные части не меняются. */
export function recordDecision(
  parts: readonly MessagePart[],
  approvalId: string,
  decision: ApprovalDecision,
): MessagePart[] | null {
  const index = parts.findIndex((part) => pendingApprovalOf(part)?.approvalId === approvalId);
  if (index < 0) return null;
  return parts.map((part, position) =>
    position !== index
      ? part
      : !isPending(part)
        ? recordHelperDecision(part, { approvalId, approved: decision.approved, ...(!decision.approved && decision.reason && { reason: decision.reason }) })
        : ({
            ...part,
            state: "approval-responded",
            approval: { id: approvalId, approved: decision.approved, ...(decision.reason && { reason: decision.reason }) },
          } as MessagePart),
  );
}

const isAwaitingExecution = (part: MessagePart): boolean =>
  isToolPart(part) &&
  ((part as ToolPartView).state === "approval-requested" || (part as ToolPartView).state === "approval-responded") &&
  Boolean((part as ToolPartView).approval?.id);

/**
 * Все запросы без результата закрыты как отклонённые: вызов без результата модель не принимает. Помощник, который ждёт
 * подтверждения или продолжения, закрыт сбоем с той же причиной.
 * `reason` — для запросов, на которые человек не ответил; `allowedReason` — для уже разрешённых, но без результата
 * (по умолчанию тот же): выполнялись они или нет, знает только вызывающий.
 */
export function denyPendingApprovals(parts: readonly MessagePart[], reason: string, allowedReason: string = reason): MessagePart[] {
  return parts.map((part) => {
    if (!isAwaitingExecution(part)) return closeWaitingHelper(part, reason, allowedReason);
    const { id, approved, reason: given } = (part as ToolPartView).approval!;
    const denial = approved === false && given ? given : approved ? allowedReason : reason;
    return { ...part, state: "output-denied", approval: { id, approved: false, reason: denial } } as MessagePart;
  });
}

/** Инструменты, для которых человек нажал «Всегда в этом чате», — по сообщениям ветки. */
export function alwaysAllowedTools(messages: ReadonlyArray<Pick<AgentChatMessage, "parts">>): Set<string> {
  const names = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (isToolPart(part) && (part as ToolPartView).approval?.reason === ALWAYS_IN_CHAT) names.add(toolNameOfPart(part));
    }
  }
  return names;
}
