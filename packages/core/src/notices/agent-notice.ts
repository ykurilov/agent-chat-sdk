/** Что случилось с задачей или разговором. */
export type AgentNoticeKind =
  | "task_done"
  | "task_failed"
  | "task_canceled"
  | "task_interrupted"
  | "task_timed_out"
  | "task_awaiting_approval"
  /** Правило приложения попросило агента написать первым. */
  | "conversation_started";

/**
 * Служебное сообщение: часть сообщения человека `{ type: "data-agent-notice", data: { notices: AgentNotice[] } }`.
 * Экран рисует его плашкой, модель получает текстом в хвосте запроса.
 */
export interface AgentNotice {
  kind: AgentNoticeKind;
  /** Есть у `task_*`. */
  taskId?: string;
  /** Название задачи («Отчёт по сделкам»); у `conversation_started` — указание агенту от приложения. */
  title: string;
  /** Уже обрезан пределом результата инструмента. */
  result?: string;
  error?: string;
  approval?: { approvalId: string; toolName: string; input: unknown };
  /** В итоге может быть чужой текст (помощник вызывал инструмент с пометкой `externalContent`). Нет — не было. */
  externalContent?: true;
}

/** Тип части сообщения со служебными сообщениями. */
export const AGENT_NOTICE_PART_TYPE = "data-agent-notice";

/** Что служба принимает для доставки служебных сообщений в чат. */
export interface DeliverNoticesInput {
  ownerId: string;
  chatId: string;
  notices: AgentNotice[];
  /** `false` — только отметка в чате (отмена человеком), агент не просыпается. */
  wakeAgent: boolean;
  /** Повтор с тем же ключом ничего не добавляет. */
  deliveryKey: string;
}

export interface DeliverNoticesResult {
  status: "delivered" | "busy" | "chat_gone";
  messageId?: string;
  turnStarted: boolean;
}

/** `ChatService.deliverNotices` (этап 4). */
export type DeliverNotices = (input: DeliverNoticesInput) => Promise<DeliverNoticesResult>;
