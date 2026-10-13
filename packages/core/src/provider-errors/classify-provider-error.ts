import type { ChatErrorKind } from "../conversation/types";
import { MissingProviderKeyError } from "../models/model-catalog";
import type { ProviderDescription } from "../models/model-catalog";
import { errorStatusCode, errorText, underlyingError } from "./error-fields";
import { isContextOverflow, isNotRetryable, looksTransient } from "./error-signs";
import { isProviderSilence } from "./transient-retry-middleware";

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
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 402 || isNotRetryable(text)) return "insufficient_funds";
  if (isContextOverflow(text, status)) return "context_overflow";
  if (status === 429) return "rate_limited";
  // Провайдер не начал отвечать или замолчал посреди ответа — для собеседника это та же перегрузка.
  if (isProviderSilence(cause)) return "overloaded";
  if (status !== undefined) return status >= 500 ? "overloaded" : "other";
  // Кода нет — решает текст.
  if (RATE_LIMIT_SIGNS.test(text)) return "rate_limited";
  return looksTransient(text) ? "overloaded" : "other";
}
