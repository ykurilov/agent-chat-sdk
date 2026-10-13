import { loadCurrentBranch } from "../conversation/load-current-branch";
import type { StoredMessage } from "../conversation/types";
import type { ChatStorage } from "../storage/chat-storage";

/**
 * Часть сообщения с записью состояния чата: `{ type: "data-app-state", data: AppStateRecord }`. Хранится в сообщении,
 * модели не отправляется, экраном не рисуется. Состояние чата — свёртка таких частей по текущей ветке.
 */
export const APP_STATE_PART_TYPE = "data-app-state" as const;

/** Самая большая запись (`AppStateRecord` в JSON), байт. */
export const APP_STATE_RECORD_MAX_BYTES = 16 * 1024;
/** Самое большое состояние чата в JSON, байт. Большие данные — в таблицу приложения, в состояние — ссылку. */
export const APP_STATE_MAX_BYTES = 256 * 1024;

const PATH_MAX_LENGTH = 200;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Состояние чата: JSON-объект. Верхние ключи на `$` — служебные ключи SDK (например, `$closed`). */
export type AppStateValues = Record<string, unknown>;

/**
 * Одна запись: сначала убрать `unset`, потом поставить `set`. Ключи — пути через точку (`fields.email`).
 * Только значения, без прибавок: повтор той же записи ничего не меняет.
 */
export interface AppStateRecord {
  set?: Record<string, unknown>;
  unset?: string[];
}

/** Состояние чата для инструмента (`model.state`): служебных ключей SDK не видит и не пишет. */
export interface AppStateAccess {
  /** Значение по пути (копия); без пути — всё состояние. Нет значения — `undefined`. */
  get(path?: string): unknown;
  /**
   * Поставить значение по пути. Недостающие объекты по пути создаются; путь через не-объект (строку, массив, `null`)
   * — `TypeError`: ключи без точек, массивы пишутся целиком. Значение — простой JSON: объекты, массивы, строки,
   * конечные числа, `true`/`false`, `null`; иное (`undefined`, `Map`, `Date`, `NaN`…) — `TypeError` (для удаления —
   * `unset`). Запись больше 16 КБ или состояние больше 256 КБ — `AppStateTooLargeError`. Неверный путь — `TypeError`.
   * После конца хода — ничего, строка в журнал.
   */
  set(path: string, value: unknown): void;
  /** Убрать значение по пути. Неверный путь или путь через не-объект — `TypeError`. После конца хода — ничего, строка в журнал. */
  unset(path: string): void;
}

/** Запись состояния: доступ инструмента, живое состояние и конец записи. */
export interface AppStateWriter extends AppStateAccess {
  /** Живое состояние вместе со служебными ключами (копия). */
  values(): AppStateValues;
  /** Запись кончилась (конец хода): дальше `set` и `unset` только пишут строку в журнал. */
  close(): void;
}

/** Запись или всё состояние больше предела: ошибка инструмента, модель видит её текст. */
export class AppStateTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppStateTooLargeError";
  }
}

/** Служебный ключ SDK: верхний ключ на `$`. */
export const isReservedAppStateKey = (key: string): boolean => key.startsWith("$");

/** Состояние без служебных ключей SDK: то, что видит приложение. `hidden` — ещё и без закрытых ключей (для браузера). */
export function publicAppState(values: AppStateValues, hidden: (key: string) => boolean = isReservedAppStateKey): AppStateValues {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !hidden(key)));
}

/** Часть сообщения с записью: для тех, кто кладёт записи в сообщение сам, а не через поток хода. */
export function appStatePart(record: AppStateRecord): StoredMessage["parts"][number] {
  return { type: APP_STATE_PART_TYPE, data: record } as StoredMessage["parts"][number];
}

/** Свёртка записей по порядку сообщений и частей поверх `base` (она не меняется). Испорченная часть пропускается. */
export function foldAppState(messages: readonly Pick<StoredMessage, "parts">[], base: AppStateValues = {}): AppStateValues {
  const values = jsonCopy(base) as AppStateValues;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== APP_STATE_PART_TYPE) continue;
      const record = storedRecord((part as { data?: unknown }).data);
      if (record) applyRecord(values, record);
    }
  }
  return values;
}

/** Состояние текущей ветки из хранилища (со служебными ключами) и последнее сообщение ветки, на котором оно снято. */
export async function loadBranchAppState(
  storage: Pick<ChatStorage, "listMessages" | "listBranchSelections">,
  chatId: string,
): Promise<{ values: AppStateValues; atMessageId: string | null }> {
  const branch = await loadCurrentBranch(storage, chatId);
  return { values: foldAppState(branch), atMessageId: branch.at(-1)?.id ?? null };
}

/**
 * Запись состояния поверх `base`: каждый `set` и `unset` — своя запись в `write`, запись без изменений не идёт.
 * `reserved` — пишет ядро: служебные ключи SDK можно писать и видеть.
 */
export function createAppStateWriter(context: {
  base: AppStateValues;
  write: (record: AppStateRecord) => void;
  logError: (message: string) => void;
  chatId: string;
  reserved?: boolean;
}): AppStateWriter {
  let current = jsonCopy(context.base) as AppStateValues;
  let closed = false;
  const reserved = context.reserved === true;

  function writable(path: string, method: string): string[] | undefined {
    const keys = checkedPath(path, method, reserved);
    if (closed) {
      context.logError(`Инструмент записал состояние «${path}» (${method}) после конца хода в чате ${context.chatId}: запись не принята`);
      return undefined;
    }
    checkThroughObjects(current, keys, method);
    return keys;
  }

  function commit(record: AppStateRecord, next: AppStateValues): void {
    context.write(record);
    current = next;
  }

  return {
    get(path) {
      const visible = reserved ? current : publicAppState(current);
      if (path === undefined) return jsonCopy(visible);
      const keys = checkedPath(path, "get", true);
      if (!reserved && isReservedAppStateKey(keys[0]!)) return undefined;
      return jsonCopy(valueAt(visible, keys));
    },
    set(path, value) {
      const json = jsonOf(value, path);
      const keys = writable(path, "set");
      if (!keys) return;
      if (JSON.stringify(valueAt(current, keys)) === json) return;
      const record: AppStateRecord = { set: { [path]: JSON.parse(json) } };
      const recordBytes = byteLength(JSON.stringify(record));
      if (recordBytes > APP_STATE_RECORD_MAX_BYTES) {
        throw new AppStateTooLargeError(
          `Запись состояния «${path}» — ${recordBytes} байт, больше 16 КБ: большие данные храните в своей таблице, а в состоянии — ссылку`,
        );
      }
      const next = jsonCopy(current) as AppStateValues;
      applyRecord(next, record);
      const stateBytes = byteLength(JSON.stringify(next));
      if (stateBytes > APP_STATE_MAX_BYTES) {
        throw new AppStateTooLargeError(
          `Состояние чата после записи «${path}» — ${stateBytes} байт, больше 256 КБ: уберите лишнее (unset) или храните большие данные в своей таблице`,
        );
      }
      commit(record, next);
    },
    unset(path) {
      const keys = writable(path, "unset");
      if (!keys || !hasValueAt(current, keys)) return;
      const record: AppStateRecord = { unset: [path] };
      const next = jsonCopy(current) as AppStateValues;
      applyRecord(next, record);
      commit(record, next);
    },
    values: () => jsonCopy(current) as AppStateValues,
    close() {
      closed = true;
    },
  };
}

function checkedPath(path: unknown, method: string, reservedAllowed: boolean): string[] {
  const keys = pathKeys(path);
  if (!keys) {
    throw new TypeError(
      `state.${method}: путь — строка 1–${PATH_MAX_LENGTH} знаков, ключи через точку, без пустых ключей и без __proto__, prototype, constructor`,
    );
  }
  if (!reservedAllowed && isReservedAppStateKey(keys[0]!)) {
    throw new TypeError(`state.${method}: верхние ключи на «$» — служебные ключи SDK, приложение их не пишет`);
  }
  return keys;
}

function pathKeys(path: unknown): string[] | undefined {
  if (typeof path !== "string" || path.length < 1 || path.length > PATH_MAX_LENGTH) return undefined;
  const keys = path.split(".");
  return keys.every((key) => key.length > 0 && !FORBIDDEN_KEYS.has(key)) ? keys : undefined;
}

/** Запись из хранилища; не та форма — `undefined`. */
function storedRecord(data: unknown): AppStateRecord | undefined {
  if (!isObject(data)) return undefined;
  const { set, unset } = data as { set?: unknown; unset?: unknown };
  if (set !== undefined && (!isObject(set) || !Object.keys(set).every((path) => pathKeys(path)))) return undefined;
  if (unset !== undefined && (!Array.isArray(unset) || !unset.every((path) => pathKeys(path)))) return undefined;
  return { ...(set !== undefined && { set: set as Record<string, unknown> }), ...(unset !== undefined && { unset: unset as string[] }) };
}

/** Применяет запись к `values` на месте: сначала `unset`, потом `set`. Пути уже проверены. */
function applyRecord(values: AppStateValues, record: AppStateRecord): void {
  for (const path of record.unset ?? []) {
    const keys = path.split(".");
    const parent = objectAt(values, keys.slice(0, -1));
    if (parent) delete parent[keys.at(-1)!];
  }
  for (const [path, value] of Object.entries(record.set ?? {})) {
    const keys = path.split(".");
    let target = values;
    for (const key of keys.slice(0, -1)) {
      const next = Object.hasOwn(target, key) ? target[key] : undefined;
      if (!isObject(next)) target[key] = {};
      target = target[key] as AppStateValues;
    }
    target[keys.at(-1)!] = jsonCopy(value);
  }
}

function objectAt(values: AppStateValues, keys: readonly string[]): AppStateValues | undefined {
  let target: unknown = values;
  for (const key of keys) {
    if (!isObject(target) || !Object.hasOwn(target, key)) return undefined;
    target = (target as AppStateValues)[key];
  }
  return isObject(target) ? (target as AppStateValues) : undefined;
}

function valueAt(values: AppStateValues, keys: readonly string[]): unknown {
  const parent = objectAt(values, keys.slice(0, -1));
  const last = keys.at(-1)!;
  return parent && Object.hasOwn(parent, last) ? parent[last] : undefined;
}

function hasValueAt(values: AppStateValues, keys: readonly string[]): boolean {
  const parent = objectAt(values, keys.slice(0, -1));
  return parent !== undefined && Object.hasOwn(parent, keys.at(-1)!);
}

/** Путь не идёт через не-объект: иначе запись молча заменила бы строку или массив объектом. */
function checkThroughObjects(values: AppStateValues, keys: readonly string[], method: string): void {
  let target: unknown = values;
  for (const [index, key] of keys.slice(0, -1).entries()) {
    if (!Object.hasOwn(target as AppStateValues, key)) return;
    target = (target as AppStateValues)[key];
    if (isObject(target)) continue;
    const kind = Array.isArray(target) ? "массив" : target === null ? "null" : typeof target;
    throw new TypeError(
      `state.${method}: путь «${keys.join(".")}» идёт через «${keys.slice(0, index + 1).join(".")}» — это ${kind}, а не объект: ключи пишите без точек, массивы — целиком`,
    );
  }
}

/** JSON значения; не простой JSON — `TypeError`. Свойства объекта со значением `undefined` пропускаются, как в JSON. */
function jsonOf(value: unknown, path: string): string {
  const problem = notPlainJson(value, "", new Set());
  if (problem !== undefined) {
    throw new TypeError(
      `state.set: значение «${path}» — не простой JSON (${problem}): только объекты, массивы, строки, конечные числа, true/false и null; чтобы убрать значение, зовите state.unset`,
    );
  }
  return JSON.stringify(value);
}

/** Что в значении не простой JSON (с местом внутри значения) или `undefined`, если всё в порядке. */
function notPlainJson(value: unknown, at: string, parents: Set<object>): string | undefined {
  const where = at === "" ? "" : ` в ${at}`;
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? undefined : `${value}${where}`;
  if (typeof value !== "object") return `${typeof value}${where}`;
  if (parents.has(value)) return `круговая ссылка${where}`;
  const inner = (key: string) => (at === "" ? key : `${at}.${key}`);
  parents.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const problem = notPlainJson(value[index], inner(String(index)), parents);
        if (problem !== undefined) return problem;
      }
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return `${prototype?.constructor?.name ?? "объект с прототипом"}${where}`;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      const problem = notPlainJson(item, inner(key), parents);
      if (problem !== undefined) return problem;
    }
    return undefined;
  } finally {
    parents.delete(value);
  }
}

function jsonCopy(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;
