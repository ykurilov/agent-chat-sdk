import type { Chat, StoredMessage } from "../conversation/types";

/**
 * Начало id приветствия (`greeting.text`), записанного SDK с 0.101.0: метка, по которой `replaceGreeting` узнаёт его без
 * догадок. Приветствия старых версий — с обычным UUID; их узнают строгие признаки (`findGreeting`).
 */
export const GREETING_ID_PREFIX = "greeting-";

export interface ReplaceGreetingInput {
  ownerId: string;
  chatId: string;
  /** Новый текст приветствия, 1–10 000 знаков, как `greeting.text`. */
  text: string;
  /**
   * Текущий текст приветствия, каким его ждёт приложение. Есть и не совпал — `not_a_greeting`
   * (`previous_text_mismatch`), ничего не записано. Страховка для старых чатов без метки.
   */
  previousText?: string;
  /** Пробный прогон: те же проверки и итог (`would_replace` вместо `replaced`), без записи и события. */
  dryRun?: boolean;
}

/** Как узнано приветствие: по метке в id (`marker`) или, у чатов старых версий, по строгим признакам (`signs`). */
export type GreetingRecognition = "marker" | "signs";

export type NotAGreetingReason = "empty_chat" | "first_message_not_greeting" | "previous_text_mismatch";

export type ReplaceGreetingResult =
  | {
      status: "replaced" | "would_replace";
      chatId: string;
      messageId: string;
      previousText: string;
      recognizedBy: GreetingRecognition;
      /** Приветствие внутри сводки автосжатия: модель видит сводку, а не новый текст. Экран показывает новый текст. */
      compacted: boolean;
    }
  | { status: "unchanged"; chatId: string; messageId: string; recognizedBy: GreetingRecognition; compacted: boolean }
  | { status: "not_a_greeting"; chatId: string; reason: NotAGreetingReason }
  /** Чата нет или он чужой. */
  | { status: "chat_not_found"; chatId: string }
  /** В чате идёт ход (здесь или на другой копии сервера): ничего не записано, повторить позже. */
  | { status: "busy"; chatId: string };

export type FoundGreeting =
  | { ok: true; message: StoredMessage; text: string; recognizedBy: GreetingRecognition }
  | { ok: false; reason: Exclude<NotAGreetingReason, "previous_text_mismatch"> };

/**
 * Приветствие чата — первое сообщение текущей ветки, и только если это точно оно: законченный ответ агента в корне,
 * ровно одна текстовая часть, без модели, провайдера, расхода и ошибки. С меткой в id этого достаточно. Без метки (чаты
 * старых версий) ещё и дата сообщения равна дате чата, и других корневых сообщений в чате нет.
 */
export function findGreeting(chat: Pick<Chat, "createdAt">, messages: readonly StoredMessage[], branch: readonly StoredMessage[]): FoundGreeting {
  const first = branch[0];
  if (!first) return { ok: false, reason: "empty_chat" };
  const [part, ...extra] = first.parts;
  const plainAnswer =
    first.role === "assistant" &&
    first.parentId === null &&
    first.status === "complete" &&
    first.modelId === null &&
    first.providerId === null &&
    first.usage === null &&
    first.error === null &&
    extra.length === 0 &&
    part?.type === "text" &&
    typeof part.text === "string";
  if (!plainAnswer) return { ok: false, reason: "first_message_not_greeting" };
  const text = (part as { text: string }).text;
  if (first.id.startsWith(GREETING_ID_PREFIX)) return { ok: true, message: first, text, recognizedBy: "marker" };
  const sameDateAsChat = Date.parse(first.createdAt) === Date.parse(chat.createdAt);
  const onlyRoot = messages.every((message) => message.parentId !== null || message.id === first.id);
  if (!sameDateAsChat || !onlyRoot) return { ok: false, reason: "first_message_not_greeting" };
  return { ok: true, message: first, text, recognizedBy: "signs" };
}
