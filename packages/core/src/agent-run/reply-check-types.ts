// Проверка готового ответа перед записью: «чужие слова», «выдуманные ссылки». Проверки — пакет `agent-chat-reply-check`
// или свои у приложения; ядро зовёт их по очереди для любого хода и канала.

export interface ReplyCheckInput {
  /** Текст последней текстовой части ответа. */
  text: string;
  ownerId: string;
  chatId: string;
  messageId: string;
  /**
   * Что агент видел: инструкция, блоки контекста, хвост шага, реплики человека на ветке, выводы инструментов и тексты
   * приложения (`knownTexts`). Ссылки отсюда — не выдуманные. Служебные сообщения (`app`, «напиши первым») и реплики
   * сотрудника сюда не входят: чужая ссылка в них не становится законной.
   */
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

/** Чей чат проверяется: по нему приложение называет свои тексты. */
export interface KnownTextsContext {
  ownerId: string;
  chatId: string;
}

/**
 * Тексты приложения вне инструкции, слова и ссылки из которых законны: первое сообщение, прощание, тексты нод, названия
 * роликов. Зовётся на каждую проверку (кэш — дело приложения). Сбой — строка в журнал, проверка идёт без этих текстов.
 */
export type KnownTexts = (context: KnownTextsContext) => readonly string[] | Promise<readonly string[]>;

/**
 * `createChatService({ replyChecks })`: список проверок или объект. `knownTexts` добавляется к `seenTexts` каждой проверки —
 * и на ходе, и в `service.checkReply`.
 */
export type ReplyChecksSetting =
  | readonly ReplyCheck[]
  | { checks: readonly ReplyCheck[]; web?: ReplyChecksWebMode; knownTexts?: KnownTexts };

/** Настройка к одному виду: проверки, режим веб-чата со значением по умолчанию и тексты приложения. */
export function resolveReplyChecks(setting: ReplyChecksSetting | undefined): { checks: readonly ReplyCheck[]; web: ReplyChecksWebMode; knownTexts?: KnownTexts } {
  if (!setting) return { checks: [], web: DEFAULT_REPLY_CHECKS_WEB };
  if (Array.isArray(setting)) return { checks: setting, web: DEFAULT_REPLY_CHECKS_WEB };
  const { checks, web, knownTexts } = setting as { checks: readonly ReplyCheck[]; web?: ReplyChecksWebMode; knownTexts?: KnownTexts };
  return { checks, web: web ?? DEFAULT_REPLY_CHECKS_WEB, ...(knownTexts && { knownTexts }) };
}
