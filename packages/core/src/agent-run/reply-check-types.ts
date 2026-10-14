// Проверка готового ответа перед записью: «чужие слова», «выдуманные ссылки». Проверки — пакет `agent-chat-reply-check`
// или свои у приложения; ядро зовёт их по очереди для любого хода и канала.

export interface ReplyCheckInput {
  /** Текст последней текстовой части ответа. */
  text: string;
  ownerId: string;
  chatId: string;
  messageId: string;
  /** Что агент видел: инструкция, блоки контекста, хвост шага, реплики человека на ветке. Ссылки отсюда — не выдуманные. */
  seenTexts: string[];
  /** Переписать моделью хода без рассуждений; расход — `answer_correction`. */
  rewrite: (system: string, prompt: string) => Promise<string>;
}

/** Новый текст (и заметка в журнал) или ничего — текст подходит. */
export type ReplyCheckResult = { text: string; note?: string } | void;

export type ReplyCheck = (input: ReplyCheckInput) => Promise<ReplyCheckResult>;

/**
 * Веб-чат печатает ответ по словам, а проверка идёт по готовому. `replace` — печатать как обычно и заменить текст, если
 * проверка его поправила; `hold` — не печатать, пока ответ не проверен («печатает…», потом ответ целиком).
 */
export type ReplyChecksWebMode = "replace" | "hold";

export const DEFAULT_REPLY_CHECKS_WEB: ReplyChecksWebMode = "replace";

/** `createChatService({ replyChecks })`: список проверок или список с режимом веб-чата. */
export type ReplyChecksSetting = readonly ReplyCheck[] | { checks: readonly ReplyCheck[]; web?: ReplyChecksWebMode };

/** Настройка к одному виду: проверки и режим веб-чата со значением по умолчанию. */
export function resolveReplyChecks(setting: ReplyChecksSetting | undefined): { checks: readonly ReplyCheck[]; web: ReplyChecksWebMode } {
  if (!setting) return { checks: [], web: DEFAULT_REPLY_CHECKS_WEB };
  if (Array.isArray(setting)) return { checks: setting, web: DEFAULT_REPLY_CHECKS_WEB };
  const { checks, web } = setting as { checks: readonly ReplyCheck[]; web?: ReplyChecksWebMode };
  return { checks, web: web ?? DEFAULT_REPLY_CHECKS_WEB };
}
