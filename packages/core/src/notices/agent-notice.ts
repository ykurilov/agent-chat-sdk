import type { AgentChannel, FinalAnswerStatus, GroupTurn, StoredMessage, UsageSource } from "../conversation/types";

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
  | "app"
  /**
   * Реплика живого сотрудника человеку (с 0.53, `ChatService.appendStaffMessage`): `title` — её текст, `staffName` — кто.
   * Модель видит её словами сотрудника, экран — сообщением сотрудника. Проверки ответа агента её текст знают; словами
   * человека (`person_link_view`) она не считается.
   */
  | "staff";

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
  /** Есть у `staff`: имя сотрудника («Ольга»); нет — просто «сотрудник». */
  staffName?: string;
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
  /**
   * Потолок ходов сервера подряд без человека (защита от петли), с 0.53. По умолчанию `MAX_SERVER_TURNS_IN_ROW` (5):
   * дальше сообщение пишется без хода. `false` — без потолка: частоту держит вызывающий (ходы по расписанию).
   */
  maxServerTurnsInRow?: number | false;
  /**
   * Канал разговора, куда пойдёт ход (с 0.81): записывается отметкой в служебное сообщение, как у сообщения человека. Нет —
   * ход по отметке последнего сообщения человека ветки (как раньше). Задаёт сервер (мессенджеры), не клиент.
   */
  channel?: AgentChannel;
  /**
   * Ход сервера в группе (с 0.81): границы группового хода — без памяти владельца и личных блоков, из инструментов
   * приложения только `allowedTools`. Нужен, когда в ветке ещё нет сообщения группы (агент пишет первым). Повтор с тем же
   * `deliveryKey` идёт по записанной отметке, а не по новой.
   */
  group?: GroupTurn;
}

export interface DeliverNoticesResult {
  status: "delivered" | "busy" | "chat_gone";
  messageId?: string;
  turnStarted: boolean;
  /**
   * Ответ хода — только при `awaitAnswer` и начатом ходе. `text` — текстовые части подряд; `parts` (с 0.53) — всё, что
   * надо доставить человеку: текст, файлы, вызовы инструментов с результатом (карточка ролика, картинка, виджет), без
   * рассуждений модели и служебных частей (`deliverableParts`).
   */
  answer?: { messageId: string; text: string; status: FinalAnswerStatus; parts: StoredMessage["parts"] };
}

/** Что служба принимает для реплики живого сотрудника в историю чата (`ChatService.appendStaffMessage`, с 0.53). */
export interface AppendStaffMessageInput {
  ownerId: string;
  chatId: string;
  /** Что сотрудник сказал человеку. Пустой — `TypeError`. */
  text: string;
  /** Кто ответил: модель и экран назовут его по имени. */
  staffName?: string;
  /** `true` — агент сразу отвечает после реплики (ход, как после служебного сообщения). По умолчанию `false`: только запись. */
  wakeAgent?: boolean;
  /** Повтор с тем же ключом ничего не добавляет. Нет — каждый вызов пишет новую реплику. */
  deliveryKey?: string;
}

/** `ChatService.deliverNotices` (этап 4). */
export type DeliverNotices = (input: DeliverNoticesInput) => Promise<DeliverNoticesResult>;
