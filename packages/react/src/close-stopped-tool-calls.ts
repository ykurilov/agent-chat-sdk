import type { AgentChatMessage } from "./chat-types";
import { stoppedToolCallReasons } from "./labels";

type MessagePart = AgentChatMessage["parts"][number];

/*
 * После «Стопа» сервер закрывает вызовы без результата и сохраняет так ответ (core: `closeHangingToolCalls` и
 * `denyPendingApprovals`). Экран делает то же сразу, не дожидаясь перезагрузки: те же состояния и те же тексты.
 */

interface ToolPartView {
  state?: string;
  preliminary?: boolean;
  approval?: { id?: string; approved?: boolean; reason?: string };
}

const isToolPart = (part: MessagePart) => part.type.startsWith("tool-") || part.type === "dynamic-tool";

/**
 * Вызовы без окончательного результата закрыты: запущенные — ошибкой, ждавшие ответа человека или уже разрешённые — отказом
 * (у разрешённого — «результат неизвестен», у отклонённого — причина человека). Остальное не тронуто.
 */
export function closeStoppedToolCalls(parts: readonly MessagePart[]): MessagePart[] {
  return parts.map((part) => {
    if (!isToolPart(part)) return part;
    const { state, preliminary, approval } = part as ToolPartView;
    if ((state === "approval-requested" || state === "approval-responded") && approval?.id) {
      const reason =
        approval.approved === false && approval.reason
          ? approval.reason
          : approval.approved
            ? stoppedToolCallReasons.resultUnknown
            : stoppedToolCallReasons.interrupted;
      return { ...part, state: "output-denied", approval: { id: approval.id, approved: false, reason } } as MessagePart;
    }
    if (state === "input-available" || (state === "output-available" && preliminary === true)) {
      const { output: _output, preliminary: _preliminary, ...rest } = part as MessagePart & { output?: unknown; preliminary?: boolean };
      return { ...rest, state: "output-error", errorText: stoppedToolCallReasons.hanging } as MessagePart;
    }
    return part;
  });
}
