import type { AppStateValues } from "../app-state/app-state";
import type { AgentAudience, Chat, UsageSource } from "../conversation/types";
import type { ModelChoice } from "../models/model-choice";
import type { AgentNotice } from "../notices/agent-notice";
import type { StaffActor, TurnAction } from "./turn-hooks";

// Типы общих точек для расширений, которые ведут разговор по своим правилам (сценарии поведения агента).
// Здесь только договор; поведение — в пакете `@ykurilov/agent-chat-flows` (docs/flows.md).

/** Что видит `prepareTurn` в начале хода. */
export interface PrepareTurnContext {
  ownerId: string;
  chatId: string;
  /** Сообщение агента, которое начинает этот ход. */
  messageId: string;
  chat: Chat;
  /** Состояние ветки до хода (свёртка `model.state`, без служебных ключей SDK). */
  state: AppStateValues;
  action: TurnAction;
  /**
   * Ход продолжает прежний ответ (подтверждение, виджет, «Повторить» после обрыва с готовыми шагами): записи состояния
   * прежнего ответа уже в `state`, сообщение человека в них учтено.
   */
  resumed: boolean;
  /** `group` — групповой чат мессенджера, `private` — разговор с владельцем. */
  audience: AgentAudience;
  /** Сотрудник, который делает ход в копии чата человека (`staffOfChat`): данные `ownerId` только читаются. */
  staff?: StaffActor;
  /** Служебные сообщения, с которыми пришёл ход (`deliverNotices`); у остальных ходов пусто. */
  notices: AgentNotice[];
  /**
   * Ход отвечает на пачку сообщений человека (`sendBurstMessage`): их id по порядку. Счёт сообщений человека за ход —
   * длина списка; нет поля — одно сообщение.
   */
  burstMessageIds?: string[];
  /** Часовой пояс человека (IANA), как у даты в запросе. */
  timeZone: string;
  /**
   * С 0.53: пояс, который прислали страница или приложение (`deliverNotices({ timeZone })`); `null` — не прислали, и
   * `timeZone` запасной (`agent.timeZone` или сервер). Нет поля — служба старше 0.53.
   */
  pageTimeZone?: string | null;
  /** Отменяется «Стопом» и сроком `prepareTurn`. */
  abortSignal: AbortSignal;
  now: Date;
}

/** Записи состояния ложатся частями `data-app-state` в начало ответа; `notices` модель видит как служебные сообщения хода. */
export interface PrepareTurnResult {
  set?: Record<string, unknown>;
  unset?: string[];
  notices?: AgentNotice[];
}

/**
 * Зовётся в начале хода, до сборки застывших блоков: так расширение записывает состояние, которое сложилось вне хода
 * (таймер, сигнал приложения, решение после прошлого хода). Ошибка или срок — ход идёт без записей, строка в журнал.
 */
export type PrepareTurn = (context: PrepareTurnContext) => Promise<PrepareTurnResult | void> | PrepareTurnResult | void;

/** Один вызов модели каталога без инструментов: проверка лимита до вызова, расход в журнал с `source`. */
export interface AskModelInput {
  ownerId: string;
  chatId: string;
  model: ModelChoice;
  system?: string;
  prompt: string;
  /** JSON Schema ответа; есть — ответ разбирается в `object`. */
  schema?: Record<string, unknown>;
  source: UsageSource;
  signal?: AbortSignal;
}

export interface AskModelResult {
  text: string;
  /** Разобранный ответ по `schema`. */
  object?: unknown;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/** `ChatService.askModel`. */
export type AskModel = (input: AskModelInput) => Promise<AskModelResult>;

/** Расход вызова мимо провайдеров ядра (например, судья у своего сервиса): в журнал расходов и лимиты. */
export interface RecordExternalUsageInput {
  ownerId: string;
  chatId: string;
  source: UsageSource;
  /** Доллары, как сообщил сервис. */
  cost: number;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  /** По умолчанию `"external"`. */
  providerId?: string;
  messageId?: string;
}

/** `ChatService.recordUsage`. */
export type RecordUsage = (input: RecordExternalUsageInput) => Promise<void>;
