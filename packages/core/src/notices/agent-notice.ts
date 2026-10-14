import type { FinalAnswerStatus, UsageSource } from "../conversation/types";

/** Что случилось с задачей или разговором. */
export type AgentNoticeKind =
  | "task_done"
  | "task_failed"
  | "task_canceled"
  | "task_interrupted"
  | "task_timed_out"
  | "task_awaiting_approval"
  /** Правило приложения попросило агента написать первым. */
  | "conversation_started"
  /** Событие приложения или расширения (сработал таймер, сигнал). Модель видит `title`, человек плашку не видит. */
  | "app";

/**
 * Служебное сообщение: часть сообщения человека `{ type: "data-agent-notice", data: { notices: AgentNotice[] } }`.
 * Экран рисует его плашкой, модель получает текстом в хвосте запроса.
 */
export interface AgentNotice {
  kind: AgentNoticeKind;
  /** Есть у `task_*`. */
  taskId?: string;
  /** Название задачи («Отчёт по сделкам»); у `conversation_started` — указание агенту от приложения; у `app` — текст для модели. */
  title: string;
  /** Есть у `app`: имя события (`flow_event`, `flow_timer`). */
  name?: string;
  /** Есть у `app`: данные события, JSON. */
  data?: unknown;
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
  /**
   * Готовый ответ агента без вызова модели; доставляется, как ответ на служебное сообщение. Пишется, только если ход
   * начался (`turnStarted`): при `wakeAgent: false`, исчерпанном лимите, закрытом чате и после 5 ходов сервера подряд
   * его нет.
   */
  reply?: { text: string };
  /** Пояс человека (IANA): дата и время в инструкции хода — по нему. Нет — пояс службы (`agent.timeZone`). */
  timeZone?: string;
  /**
   * Дождаться конца хода и отдать готовый проверенный ответ в `answer`. Каналы SDK его не доставляют: доставит
   * приложение (сценарий с `deliver`).
   */
  awaitAnswer?: boolean;
  /** Источник расхода хода. По умолчанию `answer`; агент пишет первым — `first_message`. */
  usageSource?: UsageSource;
}

export interface DeliverNoticesResult {
  status: "delivered" | "busy" | "chat_gone";
  messageId?: string;
  turnStarted: boolean;
  /** Ответ хода — только при `awaitAnswer` и начатом ходе. */
  answer?: { messageId: string; text: string; status: FinalAnswerStatus };
}

/** `ChatService.deliverNotices` (этап 4). */
export type DeliverNotices = (input: DeliverNoticesInput) => Promise<DeliverNoticesResult>;
