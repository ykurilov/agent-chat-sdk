import type { AgentChannel, HelperProgress, TaskStatus } from "@ykurilov/agent-chat-core";
import type { FlexibleSchema, ModelMessage } from "ai";

/** Задача, как она лежит в хранилище. Времена — ISO 8601. */
export interface TaskRecord {
  id: string;
  ownerId: string;
  chatId: string;
  messageId: string;
  toolCallId: string;
  channel: AgentChannel;
  kind: "tool" | "helper";
  /** Имя фонового инструмента или помощника. */
  name: string;
  input?: unknown;
  /** Для карточки и служебного сообщения. */
  title: string;
  status: TaskStatus;
  /** Шаги помощника: с них задача продолжается после перезапуска. */
  helperMessages?: ModelMessage[];
  progress?: HelperProgress;
  result?: unknown;
  error?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  attempt: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Когда служебное сообщение о конце задачи попало в чат. */
  deliveredAt?: string;
  /** Ключ служебного сообщения, с которым задачу начали доставлять: повтор после сбоя идёт той же пачкой и с тем же ключом. */
  deliveryKey?: string;
}

/** Поля, которые меняются у уже созданной задачи. */
export type TaskPatch = Partial<Omit<TaskRecord, "id" | "ownerId" | "chatId" | "createdAt">>;

/** Условие записи: аренда у этой копии, статус из списка, задача ждёт ответа именно на этот вопрос. */
export interface TaskCondition {
  leaseOwner?: string;
  statuses?: readonly TaskStatus[];
  pendingApprovalId?: string;
}

/** Что занимает место человека: новая задача или продолжение задачи с паузы (ответ на подтверждение). */
export type TaskAdmission =
  | { create: TaskRecord }
  | { resume: { ownerId: string; taskId: string; patch: TaskPatch; when: TaskCondition } };

/** Хранилище задач: память, SQLite, Postgres (контракт один). Каждая операция владельца проверяет сама. */
export interface TaskStore {
  create(task: TaskRecord): Promise<void>;
  get(ownerId: string, taskId: string): Promise<TaskRecord | null>;
  /** `when` — запись одним условным обновлением: условие не выполнено (задачу забрали, статус сменился) — `null`, запись прежняя. */
  update(ownerId: string, taskId: string, patch: TaskPatch, when?: TaskCondition): Promise<TaskRecord | null>;
  listForChat(ownerId: string, chatId: string): Promise<TaskRecord[]>;
  /** Сколько задач человека занимают место: `queued` и `running`. Задача на паузе (`awaiting_approval`) место не занимает (T055). */
  countActive(ownerId: string): Promise<number>;
  /**
   * Занимает место человека, только если у него занято меньше `maxActive` мест (как считает `countActive`): пишет новую
   * задачу (`create`) или продолжает задачу с паузы условным обновлением (`resume`, условие — как у `update`). Подсчёт
   * и запись — одно действие хранилища: копии сервера на одной базе вместе не превысят предел ни запусками, ни ответами
   * на подтверждение. Итог — записанная задача; `"no_slot"` — места нет, ничего не записано; `null` — условие
   * продолжения не выполнено.
   * Без этого метода `createBackgroundTasks` не запускается: предел по отдельным подсчёту и записи держался бы только
   * внутри одной копии.
   */
  admitWithinLimit(admission: TaskAdmission, maxActive: number): Promise<TaskRecord | "no_slot" | null>;
  /**
   * Берёт задачу в работу, если она свободна: ждёт запуска или аренда истекла. Два сервера не возьмут одну задачу.
   * `null` — не взяли.
   */
  claim(taskId: string, leaseOwner: string, leaseUntil: string, now: string): Promise<TaskRecord | null>;
  /** Продлевает аренду; `false` — задачу уже забрал другой или она закончена. */
  renewLease(taskId: string, leaseOwner: string, leaseUntil: string): Promise<boolean>;
  /** Задачи в работе, чья аренда истекла: хозяин пропал (перезапуск, падение). */
  listExpired(now: string): Promise<TaskRecord[]>;
  /** Законченные задачи чата, о которых чат ещё не знает. */
  listUndelivered(ownerId: string, chatId: string): Promise<TaskRecord[]>;
  /**
   * Отмечает доставленной пачку с ключом `deliveryKey`. Задачу, которую тем временем продолжили или отменили (ключ
   * сброшен, статус сменился), не трогает: её ведёт и доставит та копия, что её продолжила или отменила.
   */
  markDelivered(taskIds: readonly string[], deliveryKey: string, at: string): Promise<void>;
  deleteForChat(ownerId: string, chatId: string): Promise<void>;
  close?(): Promise<void>;
}

/** Контекст запуска фонового инструмента. */
export interface BackgroundRunContext {
  ownerId: string;
  chatId: string;
  /** Сигнал отмены: срабатывает по «Отменить», таймауту и закрытию службы. */
  signal: AbortSignal;
  /** Коротко, что делается сейчас; видно в карточке задачи. */
  reportProgress(text: string): void;
}

/** Фоновый инструмент: агент запускает его, ход идёт дальше, итог придёт служебным сообщением. */
export interface BackgroundToolDefinition<Input = unknown, Output = unknown> {
  description: string;
  inputSchema: FlexibleSchema<Input>;
  /** Название задачи для карточки и служебного сообщения. */
  title(input: Input): string;
  run(input: Input, context: BackgroundRunContext): Promise<Output>;
  /** Спрашивается до запуска, как у обычного инструмента. */
  needsApproval?: boolean;
  /** `true` — после перезапуска сервера запустить заново; по умолчанию задача получает «прервана». */
  rerunAfterRestart?: boolean;
  /** Предел времени; по умолчанию общий `timeoutMs` службы. */
  timeoutMs?: number;
  /**
   * Пометки инструмента, как у `tool({ metadata })`. `{ externalContent: true }` — задача приносит чужой текст (веб,
   * письма, файлы): вызов в чате помечен, и живые демонстрации в этом чате не запускаются.
   */
  metadata?: Record<string, unknown>;
}
