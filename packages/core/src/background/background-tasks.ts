import type { ToolSet } from "ai";
import type { AgentToolsModel } from "../agent-run/run-agent-turn";
import type { ChatEvents } from "../chat-events/chat-events";
import type { AgentHelper, HelperProgress, RunHelper } from "../helpers/helper-types";
import type { DeliverNotices } from "../notices/agent-notice";

/**
 * Фоновые задачи (пакет `@ykurilov/agent-chat-background`): ядро знает только этот тонкий интерфейс, как память знает
 * `LongTermMemory`. Без него запрос к модели побайтно прежний.
 */
export interface BackgroundTasks {
  /** Постоянный блок для системной инструкции. */
  instructions: string;
  toolNames: readonly string[];
  /** Фоновые инструменты, фоновые помощники, `check_tasks`, `cancel_task`. */
  tools(model: AgentToolsModel): ToolSet;
  /** Ядро зовёт один раз при создании службы. */
  attach(port: BackgroundPort): void;
  listForChat(ownerId: string, chatId: string): Promise<TaskView[]>;
  cancel(ownerId: string, chatId: string, taskId: string): Promise<"canceled" | "not_found" | "already_finished">;
  /**
   * Ответ человека на вопрос задачи `approvalId`. `stale` — задача ждёт ответа уже на другой вопрос: старый ответ
   * новый вопрос не одобряет.
   */
  answerApproval(ownerId: string, chatId: string, taskId: string, approvalId: string, decision: "allow" | "deny"): Promise<"resumed" | "not_found" | "stale">;
  chatDeleted(ownerId: string, chatId: string): Promise<void>;
  /** Зовётся вместе с `recoverInterruptedAnswers`. */
  recover(): Promise<void>;
  flush(): Promise<void>;
}

/** Что ядро даёт фону. */
export interface BackgroundPort {
  deliverNotices: DeliverNotices;
  events: ChatEvents;
  runHelper: RunHelper;
  helperModel(name: string, ownerId: string, chatId: string): Promise<AgentToolsModel>;
  assertWithinLimit(ownerId: string, chatId: string): Promise<void>;
  logError(error: unknown): void;
  /** Только фоновые помощники (`background: true`), ядро заполняет в `attach`. */
  helpers?: Record<string, AgentHelper>;
}

export type TaskStatus = "queued" | "running" | "awaiting_approval" | "done" | "failed" | "canceled" | "interrupted" | "timed_out";

/** Задача, как её видят экран и сервер. */
export interface TaskView {
  id: string;
  title: string;
  kind: "tool" | "helper";
  name: string;
  status: TaskStatus;
  startedAt: string;
  finishedAt?: string;
  progress?: HelperProgress;
}
