import type { UIMessage } from "ai";
import { stripVoiceTags } from "./voice-tags";

/*
 * Клиентские копии типов ядра. Ядро — серверный пакет с провайдерами моделей,
 * браузерной сборке оно не нужно; форма совпадает с `@ykurilov/agent-chat-core`.
 */

/** `awaiting_approval` — агент ждёт, разрешит ли человек вызов инструмента. */
export type AnswerStatus = "streaming" | "complete" | "stopped" | "error" | "interrupted" | "awaiting_approval";

export type ChatErrorKind = "overloaded" | "rate_limited" | "insufficient_funds" | "invalid_key" | "context_overflow" | "other";

/**
 * Подробности сбоя провайдера: приходят, только если сервер открыл их этому человеку (право `errorDetails` ядра, обычно
 * для админа). `reason` — одна строка до 300 знаков без секретов, `resetsAt` — когда провайдер снимет предел (ISO).
 */
export interface ChatErrorDetails {
  providerId: string;
  modelId: string;
  statusCode?: number;
  reason?: string;
  resetsAt?: string;
}

/** Сбой ответа: вид и, если сервер их отдал, подробности. */
export interface ChatError {
  kind: ChatErrorKind;
  details?: ChatErrorDetails;
}

/**
 * Что показывает `ErrorNotice`: ошибка ответа или отказ сервера чату целиком. `signed_out` — вход истёк (401),
 * `too_many_turns` — у человека уже идут ответы в других чатах (429), ход не начат; `forbidden_origin` — сервер
 * не признал страницу своей (403): фронт и API на разных адресах, а адреса фронта нет в `allowedOrigins` сервера.
 */
export type ErrorNoticeKind = ChatErrorKind | "signed_out" | "too_many_turns" | "forbidden_origin";

/** Уровень рассуждений модели (как в профиле модели ядра). */
export type ReasoningLevelId = "off" | "on" | "minimal" | "low" | "medium" | "high" | "max";

/** Решение человека по запросу подтверждения. `always` — разрешить и больше не спрашивать про этот инструмент в этом чате. */
export type ApprovalDecision = "allow" | "deny" | "always";

/** Метка сервера в решении «Всегда в этом чате»; часть протокола, слово не менять. */
export const ALWAYS_IN_CHAT = "always-in-chat";

/** Метка сервера в запросе (`approval.requestReason`): для этого вызова «Всегда в этом чате» предложена; часть протокола, слово не менять. */
export const ALWAYS_OFFERED = "always-offered";

/**
 * Почему ответ на запрос не принят: нет связи или сбой, лимит расходов, чат занят другим ходом, идут ответы в других чатах,
 * приложение не пустило ход (`refused`: причина словами приложения лежит в `text` рядом с видом).
 */
export type ApprovalFailureKind = "connection" | "spending_limit" | "busy" | "too_many_turns" | "refused";

/** Выбор собеседника, каким его хранит и отдаёт сервер. */
export interface ChatModelChoice {
  modelId: string;
  providerId: string;
  reasoning?: string;
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Размер контекста после ответа: вход плюс выход последнего шага. */
  contextTokens?: number;
  /** Есть, если числа «примерно»: прикинуты по длине текста, а не сообщены провайдером. */
  estimated?: true;
}

/** Вид звука человека (смех, вздох…); копия закрытого списка ядра: ядро браузеру не нужно. */
export type VoiceSound = "laughter" | "sigh" | "cough" | "sneeze" | "gasp" | "crying" | "yawn" | "groan";

/** Отметка обрыва озвучки: человек перебил голосом. `partIndex`/`charOffset` — где оборвалось в тексте, `spokenTail` — хвост озвученного. */
export interface VoiceCut {
  partIndex: number;
  charOffset: number;
  spokenTail: string;
}

export interface ChatMessageMetadata {
  modelId?: string;
  providerId?: string;
  usage?: TokenUsage;
  /** Длительность рассуждений по порядковому номеру части рассуждения в сообщении. */
  reasoningDurationsMs?: Record<string, number>;
  /** Заголовки раздумий по тому же номеру («Продумываю правила игры»): есть, если сервер включил `thoughtTitles`. */
  thoughtTitles?: Record<string, string>;
  status?: AnswerStatus;
  error?: ChatError;
  /** Есть, если озвучку ответа оборвало перебивание. */
  voiceCut?: VoiceCut;
  /** Ответ не дошёл до человека (сервер пометил «не доставлено»): модель его не видит. */
  undelivered?: true;
}

export type AgentChatMessage = UIMessage<ChatMessageMetadata>;

/** Запись сжатия истории: сводка заменила для модели сообщения с `fromMessageId` по `throughMessageId`. */
export interface CompactionMarker {
  id: string;
  fromMessageId: string;
  throughMessageId: string;
  /** Сводка в Markdown. */
  summary: string;
  summaryTokens: number;
  createdAt: string;
}

/** Развилка на текущей ветке: сообщение и все его соседи по порядку создания, включая его самого. */
export interface BranchFork {
  messageId: string;
  siblingIds: string[];
}

/**
 * Текст сообщения из частей: абзацы через пустую строку. У ответа голосового хода (`voiceAnswer`) теги голоса вырезаны:
 * человек видит, копирует и слышит диктором только слова. В остальных ответах скобки — обычный текст.
 */
export function messageText(message: AgentChatMessage, { voiceAnswer = false }: { voiceAnswer?: boolean } = {}): string {
  const texts = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));
  return (voiceAnswer && message.role === "assistant" ? texts.map((text) => stripVoiceTags(text)) : texts).join("\n\n");
}
