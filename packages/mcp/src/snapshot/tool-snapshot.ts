import { cutAtCharBoundary } from "@ykurilov/agent-chat-core";
import type { McpToolSnapshot } from "../types";

/** Предел описания инструмента: описание чужого сервера — канал внушения, длинное не пускаем. */
export const DESCRIPTION_MAX_CHARS = 1000;
/** Предел описания и заголовка поля схемы. */
export const SCHEMA_FIELD_MAX_CHARS = 300;
/** Предел схемы входа в знаках JSON: больше — инструмент не включается. */
export const SCHEMA_MAX_CHARS = 16_384;
/** Предел заголовка инструмента. */
const TITLE_MAX_CHARS = 120;
/** Имя инструмента у сервера: то, что модель примет после префикса. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Управляющие знаки (кроме перевода строки и табуляции), невидимые и знаки направления письма, «теги» Юникода:
 * через них прячут указания от глаз админа.
 */
const HIDDEN_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]|[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
/** Половинка эмодзи без пары: её не примет ни JSON модели, ни PostgreSQL. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Теги вида `<IMPORTANT>`, `</system>`: «приказы» модели. Текст внутри остаётся. */
const MARKUP_TAG = /<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?>/g;

/** Текст чужого сервера без скрытых знаков и тегов, с пределом длины (обрезка с «…»). */
export function cleanExternalText(text: string, maxChars: number): string {
  const cleaned = text.normalize("NFC")
    .replace(LONE_SURROGATE, "")
    .replace(HIDDEN_CHARACTERS, "")
    .replace(MARKUP_TAG, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length <= maxChars ? cleaned : `${cutAtCharBoundary(cleaned, maxChars - 1).trimEnd()}…`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Ключи схемы, где лежат значения от сервера (подсказки модели), а не устройство схемы: чужой текст. */
const VALUE_KEYS = new Set(["enum", "default", "examples", "const"]);
/** Имя поля входа: модель пишет его в вызове как есть, поэтому не чистим, а проверяем. */
const FIELD_NAME = /^[\p{L}\p{N}_.$@-]{1,64}$/u;

/** Все строки внутри значения — чужой текст. */
function cleanValues(value: unknown): unknown {
  if (typeof value === "string") return cleanExternalText(value, SCHEMA_FIELD_MAX_CHARS);
  if (Array.isArray(value)) return value.map(cleanValues);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanValues(item)]));
}

/** Схема с вычищенными `description`, `title` и значениями (`enum`, `default`, …) на любой глубине; порядок ключей прежний. */
function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if ((key === "description" || key === "title") && typeof item === "string") return [key, cleanExternalText(item, SCHEMA_FIELD_MAX_CHARS)];
      if (VALUE_KEYS.has(key)) return [key, cleanValues(item)];
      // Имена полей в `properties` — тоже ключи, но не схемы: чистим только их значения.
      return [key, cleanSchema(item)];
    }),
  );
}

/** Есть ли на любой глубине поле с именем длиннее 64 знаков, со скрытыми знаками или разметкой. */
function hasBadFieldName(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasBadFieldName);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    if (key === "properties" && isRecord(item) && Object.keys(item).some((name) => !FIELD_NAME.test(name))) return true;
    return !VALUE_KEYS.has(key) && hasBadFieldName(item);
  });
}

/** Инструмент, как его прислал `tools/list`. */
export interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { title?: string; readOnlyHint?: boolean };
}

const EMPTY_SCHEMA = (): Record<string, unknown> => ({ type: "object", properties: {} });

/** Снимок списка: чистый текст в пределах; инструменты, которые нельзя включить, остаются с причиной. */
export function snapshotTools(listed: readonly ListedTool[]): McpToolSnapshot[] {
  const seen = new Set<string>();
  return listed.map((tool) => {
    const title = tool.title ?? tool.annotations?.title;
    const snapshot: McpToolSnapshot = { name: cutAtCharBoundary(tool.name, 200), inputSchema: EMPTY_SCHEMA() };
    if (title !== undefined) snapshot.title = cleanExternalText(title, TITLE_MAX_CHARS);
    if (tool.description !== undefined) snapshot.description = cleanExternalText(tool.description, DESCRIPTION_MAX_CHARS);
    if (tool.annotations?.readOnlyHint === true) snapshot.readOnly = true;

    const schema = cleanSchema(isRecord(tool.inputSchema) ? tool.inputSchema : EMPTY_SCHEMA()) as Record<string, unknown>;
    if (!TOOL_NAME.test(tool.name)) snapshot.problem = "bad_name";
    else if (seen.has(tool.name)) snapshot.problem = "duplicate_name";
    else if (hasBadFieldName(schema)) snapshot.problem = "bad_field_name";
    else if (JSON.stringify(schema).length > SCHEMA_MAX_CHARS) snapshot.problem = "schema_too_large";
    else snapshot.inputSchema = schema;
    seen.add(tool.name);
    return snapshot;
  });
}
