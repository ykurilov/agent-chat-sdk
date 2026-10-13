import { APICallError } from "ai";
import type { ChatErrorKind } from "../conversation/types";
import type { ModelCatalog } from "../models/model-catalog";
import { cutAtCharBoundary } from "../text/safe-truncate";
import { environmentSecrets, scrubSecrets } from "../text/scrub-secrets";
import { errorName, errorStatusCode, underlyingError } from "./error-fields";

/** Сколько знаков тела ответа попадает в журнал. */
const MAX_BODY_LENGTH = 4_000;

export interface ProviderFailureContext {
  chatId: string;
  modelId: string;
  providerId: string;
  kind: ChatErrorKind;
  /** Окружение сервера: значения ключей провайдеров вычищаются из тела. */
  env: Record<string, string | undefined>;
  catalog: ModelCatalog;
}

/**
 * Одна строка журнала о сбое провайдера (FR-005): чат, модель, провайдер, вид, код, имя ошибки и до 4000 знаков тела
 * ответа или сообщения. Секреты заменены на `[скрыто]`, заголовков нет вовсе.
 */
export function describeProviderFailure(error: unknown, context: ProviderFailureContext): string {
  const cause = underlyingError(error);
  const status = errorStatusCode(cause);
  const body = bodyOf(cause);
  const shown = body === undefined ? "тело пустое" : cutAtCharBoundary(scrubSecrets(oneLine(body), environmentSecrets(context.env, context.catalog)), MAX_BODY_LENGTH);
  return (
    `[сбой провайдера] чат=${context.chatId} модель=${context.modelId} провайдер=${context.providerId} вид=${context.kind} ` +
    `код=${status ?? "нет"} имя=${errorName(cause) ?? "нет"} тело=${shown}`
  );
}

/** Тело ответа, иначе сообщение ошибки (у куска потока — и вложенное `error.message`). Пустое или не текст — нет. */
function bodyOf(error: unknown): string | undefined {
  const candidates: unknown[] = [];
  if (APICallError.isInstance(error)) candidates.push(error.responseBody);
  if (typeof error === "object" && error !== null) {
    const fields = error as { message?: unknown; error?: unknown };
    candidates.push(fields.message);
    if (typeof fields.error === "object" && fields.error !== null) candidates.push((fields.error as { message?: unknown }).message);
  }
  return candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "");
}

function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}
