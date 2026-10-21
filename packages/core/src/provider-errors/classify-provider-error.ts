import type { ChatErrorKind } from "../conversation/types";
import { MissingProviderKeyError } from "../models/model-catalog";
import type { ProviderDescription } from "../models/model-catalog";
import { errorStatusCode, errorText, underlyingError } from "./error-fields";
import { isContextOverflow, isNotRetryable, looksTransient } from "./error-signs";
import { isNetworkFailure } from "./network-failure";
import { isProviderSilence } from "./transient-retry-middleware";

/** 403 с явными словами о ключе: ключ не принят. */
const KEY_SIGNS = /api[ _-]?key|authenticat|unauthori[sz]ed|credential|access[ _-]?token|key (?:is )?(?:invalid|revoked|expired|disabled)/i;
/**
 * Исчерпан предел расходов ключа: бюджет кончился, ключ при этом верный. OpenRouter — «Key limit exceeded» и
 * `limit_source: openrouter_key_limit` (403, в тексте бывает «API key»); шлюзы с бюджетом ключа — «ExceededBudget»,
 * «Budget has been exceeded» (401, 400). Проверяется раньше кода и слов о ключе.
 */
const KEY_LIMIT_SIGNS =
  /key limit exceeded|openrouter_key_limit|ExceededBudget|budget has been exceeded|(?:key|token) has (?:reached|exceeded) its (?:spend(?:ing)?|budget|usage) limit/i;
/** 403 с явными словами о деньгах. */
const FUNDS_SIGNS = /insufficient (?:credits|funds|balance)/i;
/** 403 модерации: провайдер отказал из-за содержимого. */
const MODERATION_SIGNS = /flagged|moderation|content[ _-]?policy|safety/i;

/** Лимит запросов, названный текстом без кода ответа (кусок потока, ошибка SDK). */
const RATE_LIMIT_SIGNS = /rate.?limit|too many requests|throttl|please wait|ResourceExhausted/i;

/**
 * Вид ошибки провайдера для собеседника. Наружу идёт только вид: сырой текст провайдера может
 * содержать служебные данные. Особенности провайдера (`errorHints`) проверяются раньше общих правил.
 * Порядок общий с тихими повторами: «не повторять» → переполнение → «повторять».
 */
export function classifyProviderError(
  error: unknown,
  provider?: Pick<ProviderDescription, "errorHints">,
): ChatErrorKind {
  // Ключа нет вовсе — для собеседника это тот же неподходящий ключ.
  if (error instanceof MissingProviderKeyError) return "invalid_key";
  const cause = underlyingError(error);
  const status = errorStatusCode(cause);
  const text = errorText(cause);

  for (const hint of provider?.errorHints ?? []) {
    if (hint.match.test(text)) return hint.kind;
  }
  if (KEY_LIMIT_SIGNS.test(text)) return "insufficient_funds";
  if (status === 401) return "invalid_key";
  // 403 — не только ключ: модерация, регион, доступ к модели. Ключ и деньги — только по явным словам.
  if (status === 403) {
    if (KEY_SIGNS.test(text)) return "invalid_key";
    return FUNDS_SIGNS.test(text) || isNotRetryable(text) ? "insufficient_funds" : "other";
  }
  if (status === 402 || isNotRetryable(text, status)) return "insufficient_funds";
  if (isContextOverflow(text, status)) return "context_overflow";
  if (status === 429) return "rate_limited";
  // Провайдер не начал отвечать или замолчал посреди ответа — для собеседника это та же перегрузка.
  if (isProviderSilence(cause)) return "overloaded";
  if (status !== undefined) return status >= 500 ? "overloaded" : "other";
  // Кода ответа нет — текстовые признаки и ошибка транспорта.
  if (RATE_LIMIT_SIGNS.test(text)) return "rate_limited";
  if (isNetworkFailure(cause)) return "overloaded";
  return looksTransient(text) ? "overloaded" : "other";
}

/**
 * Провайдер отказал по доступу (403 без слов о ключе и деньгах): регион, доступ к модели. Другой провайдер может
 * ответить. Модерация — не такой отказ: дело в содержимом, и другому провайдеру оно не передаётся.
 */
export function isAccessRefusal(error: unknown): boolean {
  const cause = underlyingError(error);
  return errorStatusCode(cause) === 403 && !MODERATION_SIGNS.test(errorText(cause));
}

/** Отказ — исчерпанный предел расходов ключа, а не пустой счёт: для громкой строки владельцу. */
export function isKeyLimit(error: unknown): boolean {
  return KEY_LIMIT_SIGNS.test(errorText(underlyingError(error)));
}
