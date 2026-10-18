import { APICallError } from "ai";
import type { ChatErrorDetails } from "../conversation/types";
import type { ModelCatalog } from "../models/model-catalog";
import { cutAtCharBoundary } from "../text/safe-truncate";
import { environmentSecrets, scrubSecrets } from "../text/scrub-secrets";
import { errorStatusCode, underlyingError } from "./error-fields";

/** Сколько знаков причины уходит в подробности сбоя. */
const MAX_REASON_LENGTH = 300;

export interface ProviderErrorDetailsContext {
  providerId: string;
  modelId: string;
  /** Окружение сервера: значения ключей провайдеров вычищаются из причины. */
  env: Record<string, string | undefined>;
  catalog: ModelCatalog;
  /** Часы хода, мс: «через N секунд» и проверка, что дата обнуления в будущем. По умолчанию — сейчас. */
  now?: () => number;
}

/** Дальше этого дата обнуления — не про предел, а ошибка разбора. */
const MAX_RESET_AHEAD_MS = 2 * 366 * 24 * 60 * 60 * 1000;

/**
 * Подробности сбоя для админа: провайдер, модель, код, причина одной строкой (сообщение провайдера из тела ответа, без
 * секретов и параметров адресов) и когда провайдер снимет предел — из метаданных (`limit_reset`, `resets_at`) или
 * текста сообщения о пределе («Key limit exceeded … resets 2026-11-01»). Дата принимается только в будущем и не дальше
 * двух лет; время без пояса — UTC.
 */
export function providerErrorDetails(error: unknown, context: ProviderErrorDetailsContext): ChatErrorDetails {
  const cause = underlyingError(error);
  const statusCode = errorStatusCode(cause);
  const { message, metadata } = providerMessageOf(cause);
  const reason = message === undefined ? undefined : shownReason(message, environmentSecrets(context.env, context.catalog));
  const nowMs = (context.now ?? Date.now)();
  const found = resetFromMetadata(metadata, nowMs) ?? (message === undefined ? undefined : resetFromText(message));
  const resetsAt = found !== undefined && found > nowMs && found - nowMs <= MAX_RESET_AHEAD_MS ? new Date(found).toISOString() : undefined;
  return {
    providerId: context.providerId,
    modelId: context.modelId,
    ...(statusCode !== undefined && { statusCode }),
    ...(reason !== undefined && reason !== "" && { reason }),
    ...(resetsAt !== undefined && { resetsAt }),
  };
}

interface ProviderMessage {
  message?: string;
  metadata?: unknown;
}

/** Сообщение провайдера: `error.message` из тела JSON или куска потока, иначе тело или сообщение ошибки как есть. */
function providerMessageOf(error: unknown): ProviderMessage {
  if (APICallError.isInstance(error)) {
    const fromBody = typeof error.responseBody === "string" ? fromJson(error.responseBody) : undefined;
    if (fromBody?.message !== undefined) return fromBody;
    const raw = [error.responseBody, error.message].find(isText);
    return { ...(raw !== undefined && { message: raw }), metadata: fromBody?.metadata };
  }
  if (typeof error === "string") return isText(error) ? { message: error } : {};
  return fromObject(error) ?? {};
}

function fromJson(body: string): ProviderMessage | undefined {
  try {
    return fromObject(JSON.parse(body));
  } catch {
    return undefined;
  }
}

/** `{ error: { message, metadata } }`, `{ error: "текст" }` или `{ message }`. */
function fromObject(value: unknown): ProviderMessage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields = value as { message?: unknown; error?: unknown; metadata?: unknown };
  if (typeof fields.error === "object" && fields.error !== null) {
    const nested = fields.error as { message?: unknown; metadata?: unknown };
    if (isText(nested.message)) return { message: nested.message, metadata: nested.metadata };
  }
  if (isText(fields.error)) return { message: fields.error, metadata: fields.metadata };
  if (isText(fields.message)) return { message: fields.message, metadata: fields.metadata };
  return undefined;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** Адрес без параметров и якоря: в них бывают токены и подписи. */
const URL_WITH_QUERY = /(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g;

/** Не секреты, но лишнее и в причине: id организации и проекта у провайдера, e-mail. */
const ACCOUNT_IDS = [/\borg-[A-Za-z0-9]{6,}/g, /\bproj_[A-Za-z0-9]{6,}/g, /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g];

function shownReason(message: string, knownSecrets: string[]): string {
  const oneLine = message.replace(/\s*[\r\n]+\s*/g, " ").trim();
  let shown = scrubSecrets(oneLine.replace(URL_WITH_QUERY, "$1"), knownSecrets);
  for (const pattern of ACCOUNT_IDS) shown = shown.replace(pattern, "[скрыто]");
  return cutAtCharBoundary(shown, MAX_REASON_LENGTH);
}

/** Поле метаданных о сбросе предела: `limit_reset`, `resets_at`, `reset_seconds`… */
const RESET_FIELD = /reset/i;
/** Поле — срок «через сколько»: секунды или миллисекунды, а не момент. */
const RELATIVE_FIELD = /sec|after|in$|_in_|ms$|_ms|Ms$/i;
const MS_FIELD = /ms$|_ms|Ms$/;
/** Меньше этого число секунд — срок, а не Unix-время (около 2001 года). */
const MIN_UNIX_SECONDS = 1e9;

/** Момент сброса из метаданных, мс. */
function resetFromMetadata(metadata: unknown, nowMs: number): number | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  for (const [key, value] of Object.entries(metadata)) {
    if (!RESET_FIELD.test(key)) continue;
    const parsed = typeof value === "number" ? fromNumber(key, value, nowMs) : typeof value === "string" ? fromDateText(value) : undefined;
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/**
 * Число в поле сброса: поле про срок (`reset_seconds`, `reset_after`, `reset_ms`) или число меньше 10⁹ — «через N»
 * от сейчас; иначе Unix-время: секунды, а больше 10¹² — миллисекунды.
 */
function fromNumber(key: string, value: number, nowMs: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (RELATIVE_FIELD.test(key) || value < MIN_UNIX_SECONDS) return nowMs + (MS_FIELD.test(key) ? value : value * 1000);
  return value < 1e12 ? value * 1000 : value;
}

/** Сообщение о пределе: в начале — слова про предел, бюджет или квоту («Key limit exceeded», «Budget exceeded»). */
const LIMIT_MESSAGE_START = /^[^'"«“]{0,80}?\b(?:limit|budget|quota)\b/i;
/** Кусок в кавычках: провайдер так повторяет ввод человека. */
const QUOTED = /'[^']*'|"[^"]*"|«[^»]*»|“[^”]*”/g;
/** «resets 2026-11-01», «resets at 2026-11-01T00:00:00Z», «reset on 2026-11-01 00:00». */
const RESET_IN_TEXT = /\bresets?\s+(?:at\s+|on\s+)?(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)/i;

/** Дата сброса из текста — только из сообщения о пределе и не из кавычек, мс. */
function resetFromText(message: string): number | undefined {
  if (!LIMIT_MESSAGE_START.test(message)) return undefined;
  const found = RESET_IN_TEXT.exec(message.replace(QUOTED, " "))?.[1];
  return found === undefined ? undefined : fromDateText(found);
}

/** Дата ISO, мс; только день — полночь UTC, время без пояса — UTC. День, которого нет в календаре (2026-02-30), — нет. */
function fromDateText(text: string): number | undefined {
  const trimmed = text.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(trimmed);
  if (!match) return undefined;
  const [, year, month, day, time, zone] = match;
  const calendarDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendarDay.getUTCMonth() !== Number(month) - 1 || calendarDay.getUTCDate() !== Number(day)) return undefined;
  const parsed = Date.parse(`${year}-${month}-${day}${time === undefined ? "" : `T${time}${zone ?? "Z"}`}`);
  return Number.isNaN(parsed) ? undefined : parsed;
}
