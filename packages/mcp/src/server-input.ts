import { checkedServerAddress } from "./connection/guarded-fetch";
import { McpError } from "./mcp-error";
import type { McpServerStatus, McpTransportKind } from "./types";

/** Что админ вводит при добавлении сервера. */
export interface McpServerInput {
  name: string;
  /** Латиница в нижнем регистре, цифры и `_`, с буквы, без `__` и `_` на конце; уникален. */
  prefix: string;
  url: string;
  /** По умолчанию `http` (Streamable HTTP). */
  transport?: McpTransportKind;
  /** Заголовки «имя → значение»: ключи, токены. */
  headers?: Record<string, string>;
  viaProxy?: boolean;
  /** Срок ответа, мс; по умолчанию 30 000. */
  timeoutMs?: number;
  /** По умолчанию `off`: сначала включить инструменты, потом открыть. */
  status?: McpServerStatus;
}

/**
 * Правка сервера. `headers` — новый полный список: значение `null` оставляет прежнее значение заголовка
 * (экран его не знает), заголовка нет в списке — он удаляется. Нет поля — заголовки не меняются.
 */
export interface McpServerPatch {
  name?: string;
  prefix?: string;
  url?: string;
  transport?: McpTransportKind;
  headers?: Record<string, string | null>;
  viaProxy?: boolean;
  timeoutMs?: number;
  status?: McpServerStatus;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const NAME_MAX = 80;
const PREFIX = /^[a-z][a-z0-9_]{0,19}$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const HEADER_VALUE_MAX = 4_000;
const HEADERS_MAX = 20;
/** Эти заголовки ставит сам клиент MCP или `fetch`: админ их не задаёт. */
const RESERVED_HEADERS = new Set(["host", "content-length", "content-type", "accept", "connection", "transfer-encoding", "mcp-session-id", "mcp-protocol-version", "last-event-id", "cookie"]);
const STATUSES: readonly McpServerStatus[] = ["off", "admins", "everyone"];
const TRANSPORTS: readonly McpTransportKind[] = ["http", "sse"];

const bad = (message: string) => new McpError("bad_input", message);

export function checkedName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > NAME_MAX) throw bad(`Название: от 1 до ${NAME_MAX} знаков.`);
  return trimmed;
}

export function checkedPrefix(prefix: unknown): string {
  // Без «__» и без «_» на конце: тогда префикс однозначно отделяется от имени инструмента в `префикс__имя`.
  if (typeof prefix !== "string" || !PREFIX.test(prefix) || prefix.includes("__") || prefix.endsWith("_")) {
    throw bad("Префикс: латиница в нижнем регистре, цифры и «_», с буквы, до 20 знаков, без «__» и без «_» на конце.");
  }
  return prefix;
}

export function checkedStatus(status: unknown): McpServerStatus {
  if (!STATUSES.includes(status as McpServerStatus)) throw bad("Статус: off, admins или everyone.");
  return status as McpServerStatus;
}

export function checkedTransport(transport: unknown): McpTransportKind {
  if (!TRANSPORTS.includes(transport as McpTransportKind)) throw bad("Способ связи: http или sse.");
  return transport as McpTransportKind;
}

export function checkedTimeout(timeoutMs: unknown): number {
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw bad(`Срок ответа: от ${MIN_TIMEOUT_MS / 1000} до ${MAX_TIMEOUT_MS / 1000} секунд.`);
  }
  return timeoutMs;
}

export function checkedBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw bad(`${field}: нужно да или нет.`);
  return value;
}

/** Адрес и то, что из него видно на экране. */
export function checkedUrl(url: unknown, allowPrivateNetwork: boolean): { href: string; displayUrl: string; hasHiddenParts: boolean } {
  if (typeof url !== "string" || url.length > 2_000) throw bad("Адрес сервера: строка до 2000 знаков.");
  const parsed = checkedServerAddress(url.trim(), allowPrivateNetwork);
  return { href: parsed.href, displayUrl: `${parsed.origin}${parsed.pathname}`, hasHiddenParts: parsed.search !== "" || parsed.hash !== "" };
}

/** Заголовки: имена по правилам HTTP, без служебных; значения — одна строка. */
export function checkedHeaders(headers: unknown, previous: Readonly<Record<string, string>> = {}): Record<string, string> {
  if (headers === undefined) return {};
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) throw bad("Заголовки: объект «имя → значение».");
  const entries = Object.entries(headers as Record<string, unknown>);
  if (entries.length > HEADERS_MAX) throw bad(`Заголовков не больше ${HEADERS_MAX}.`);
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) throw bad(`Заголовок «${name.slice(0, 40)}»: недопустимое имя.`);
    if (RESERVED_HEADERS.has(name.toLowerCase())) throw bad(`Заголовок ${name} ставит сам клиент — задавать его не нужно.`);
    if (seen.has(name.toLowerCase())) throw bad(`Заголовок ${name} указан дважды.`);
    seen.add(name.toLowerCase());
    const kept = value === null ? previous[name] : value;
    if (typeof kept !== "string" || kept === "") throw bad(`Заголовок ${name}: нужно значение.`);
    if (kept.length > HEADER_VALUE_MAX || /[\r\n\0]/.test(kept)) throw bad(`Заголовок ${name}: одна строка до ${HEADER_VALUE_MAX} знаков.`);
    result[name] = kept;
  }
  return result;
}
