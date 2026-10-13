import type { ModelMessage } from "ai";
import type { AgentToolsModel, AgentToolsSource } from "../agent-run/run-agent-turn";
import type { ModelChoice } from "../models/model-choice";

/**
 * Помощник: узкий агент со своей инструкцией, моделью и инструментами. Вход — одно задание. Для основного агента это
 * инструмент `helper_<имя>`: человек видит весь ход помощника, модель основного агента — только итог.
 */
export interface AgentHelper {
  /** Для основного агента: когда звать. Входит в описание инструмента `helper_<имя>`. */
  description: string;
  instructions: string;
  /** Выбор из каталога приложения. */
  model: ModelChoice;
  /** Тот же вид, что у `agent.tools`; браузерных инструментов и `helper_*` у помощника не бывает. */
  tools?: AgentToolsSource;
  /** Предел шагов; по умолчанию 10. */
  maxSteps?: number;
  /** `true` — помощник работает задачей пакета фона. */
  background?: boolean;
}

/** Один шаг помощника: вызов инструмента (имя, вход, коротко результат) или кусок текста. */
export type HelperStep =
  | { type: "tool"; toolName: string; input: unknown; output?: unknown; error?: string }
  | { type: "text"; text: string };

/** Подтверждение, которого помощник ждёт у человека. */
export interface HelperPendingApproval {
  approvalId: string;
  toolName: string;
  /** `title` инструмента: что помощник хочет сделать, понятными словами; нет — экран показывает `toolName`. */
  title?: string;
  input: unknown;
}

/** Промежуточный и итоговый результат `helper_<имя>`: человек видит всё, модель — только `text`. */
export interface HelperProgress {
  task: string;
  /** Вызовы инструментов и куски текста; результат каждого вызова обрезан до 2 КБ. */
  steps: HelperStep[];
  /** Итог; пока помощник работает — то, что написано. */
  text: string;
  status: "running" | "awaiting_approval" | "done" | "failed" | "background";
  pendingApproval?: HelperPendingApproval;
  /** Для `background: true`. */
  taskId?: string;
  error?: string;
  /**
   * Помощник вызывал инструмент с пометкой `metadata: { externalContent: true }`: в его итоге может быть чужой текст.
   * Чат с таким итогом живые демонстрации не запускает. Нет — чужого текста не было.
   */
  externalContent?: true;
}

/** Один шаг цикла помощника, как его отдаёт `runHelper` пакету фона. */
export interface HelperStepReport {
  messages: ModelMessage[];
  progress: HelperProgress;
}

/** Что нужно `runHelper` для одного запуска цикла помощника с сохранёнными шагами. */
export interface RunHelperInput {
  name: string;
  helper: AgentHelper;
  task: string;
  model: AgentToolsModel;
  /** Шаги, сохранённые до перезапуска: цикл продолжается с них, траты за них не повторяются. */
  priorMessages?: ModelMessage[];
  /** Зовётся после каждого шага. */
  onStep(step: HelperStepReport): Promise<void>;
  abortSignal: AbortSignal;
}

export interface RunHelperResult {
  text: string;
  status: "done" | "failed" | "awaiting_approval";
  messages: ModelMessage[];
}

/** Для пакета фона: один запуск цикла помощника. Реализация — в ядре (этап 1). */
export type RunHelper = (input: RunHelperInput) => Promise<RunHelperResult>;
