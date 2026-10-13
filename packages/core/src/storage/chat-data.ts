import type { Chat } from "../conversation/types";

/** Предел данных чата (`Chat.data`) в JSON, байт. */
export const CHAT_DATA_MAX_BYTES = 16 * 1024;

/** Значение, по которому `listChats` ищет чат: строка, число, булево или `null`. */
export type ChatDataFilterValue = string | number | boolean | null;

/** Фильтр `listChats` по данным чата: все указанные верхние ключи равны значениям. */
export type ChatDataFilter = Record<string, ChatDataFilterValue>;

/** Правка данных чата больше предела: данные не изменены. */
export class ChatDataTooLargeError extends TypeError {
  constructor(readonly maxBytes: number) {
    super(`Данные чата больше ${maxBytes / 1024} КБ.`);
    this.name = "ChatDataTooLargeError";
  }
}

function jsonBytes(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Верхний ключ `__proto__` не принимается: при слиянии он тихо стал бы прототипом объекта, и значение пропало бы.
 * Отказ с понятным текстом лучше, чем молчаливая потеря. Вложенные ключи не затронуты.
 */
export function assertNoProtoKey(data: Record<string, unknown>, what: string): void {
  if (Object.hasOwn(data, "__proto__")) throw new TypeError(`${what}: ключ __proto__ не поддерживается, назовите его иначе.`);
}

const NUL = "\u0000";

/**
 * Символ NUL (`\u0000`) не принимается ни в ключах, ни в строках на любой глубине: PostgreSQL не читает его в JSON, и
 * один такой чат ломал бы поиск по данным во всём списке человека. Отказ одинаков во всех хранилищах.
 */
export function assertNoNulChar(value: unknown, what: string): void {
  if (typeof value === "string") {
    if (value.includes(NUL)) throw new TypeError(`${what}: символ NUL (\\u0000) не поддерживается.`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoNulChar(item, what);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    assertNoNulChar(key, what);
    assertNoNulChar(item, what);
  }
}

/** JSON-объект до 16 КБ или `TypeError`. `what` — как назвать данные в тексте ошибки. */
export function assertChatData(data: unknown, what = "Данные чата"): asserts data is Record<string, unknown> {
  if (!isRecord(data)) throw new TypeError(`${what} — JSON-объект.`);
  assertNoProtoKey(data, what);
  assertNoNulChar(data, what);
  let size: number;
  try {
    size = jsonBytes(data);
  } catch {
    throw new TypeError(`${what} не переводятся в JSON.`);
  }
  if (size > CHAT_DATA_MAX_BYTES) throw new TypeError(`${what} больше ${CHAT_DATA_MAX_BYTES / 1024} КБ.`);
}

/** Патч данных чата — JSON-объект; размер итога проверяет хранилище при слиянии. */
export function assertChatDataPatch(patch: unknown): asserts patch is Record<string, unknown> {
  if (!isRecord(patch)) throw new TypeError("Правка данных чата — объект.");
  assertNoProtoKey(patch, "Правка данных чата");
  assertNoNulChar(patch, "Правка данных чата");
}

/** Фильтр по данным: значения только строка, число, булево, `null`; иначе `TypeError`. */
export function assertChatDataFilter(filter: unknown): asserts filter is ChatDataFilter {
  if (!isRecord(filter)) throw new TypeError("Фильтр по данным чата — объект.");
  assertNoProtoKey(filter, "Фильтр по данным чата");
  assertNoNulChar(filter, "Фильтр по данным чата");
  for (const [key, value] of Object.entries(filter)) {
    const scalar = value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
    if (!scalar) throw new TypeError(`Фильтр по данным чата: значение ключа «${key}» — строка, число, булево или null.`);
  }
}

/**
 * Слияние верхних ключей: ключ патча заменяет старый целиком, ключ со значением `undefined` удаляется. Итог до
 * `maxBytes` (иначе `ChatDataTooLargeError`); не осталось ключей — `undefined` (у чата нет данных).
 */
export function mergeChatData(current: Record<string, unknown> | undefined, patch: Record<string, unknown>, maxBytes: number): Record<string, unknown> | undefined {
  assertChatDataPatch(patch);
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  // Размер — по тому, что реально ляжет в базу: через JSON.
  const stored = JSON.parse(JSON.stringify(merged)) as Record<string, unknown>;
  if (jsonBytes(stored) > maxBytes) throw new ChatDataTooLargeError(maxBytes);
  return Object.keys(stored).length === 0 ? undefined : stored;
}

/** Совпадает ли чат с фильтром: у чата без данных — только с пустым фильтром. */
export function chatDataMatches(data: Record<string, unknown> | undefined, filter: ChatDataFilter): boolean {
  return Object.entries(filter).every(([key, value]) => data !== undefined && Object.hasOwn(data, key) && data[key] === value);
}

/** Данные из входа хранилища: `data`, а у старого кода — `subjectData`. */
export function chatDataOfInput(input: Pick<Chat, "data" | "subjectData">): Record<string, unknown> | undefined {
  return input.data ?? input.subjectData;
}

/** Поля данных записи чата: `data` и `subjectData` — один объект; данных нет — полей нет. */
export function chatDataFields(data: Record<string, unknown> | null | undefined): Pick<Chat, "data" | "subjectData"> {
  return data == null ? {} : { data, subjectData: data };
}
