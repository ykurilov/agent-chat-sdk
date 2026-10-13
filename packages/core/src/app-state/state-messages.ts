import type { UIMessageChunk } from "ai";
import type { ChatClosure } from "../access/chat-closure";
import { newStoredMessage } from "../conversation/types";
import type { StoredMessage } from "../conversation/types";
import { APP_STATE_PART_TYPE, appStatePart, isReservedAppStateKey } from "./app-state";
import type { AppStateRecord, AppStateValues } from "./app-state";
import { FROZEN_CONTEXT_PART_TYPE } from "../frozen-context/context-blocks";
import { END_TURN_PART_TYPE } from "../agent-run/end-turn";

/** Служебный ключ закрытия чата: `{ code, message }` на ветке — чат закрыт. */
export const CLOSED_STATE_KEY = "$closed";

type Part = StoredMessage["parts"][number];

/** Закрытие в состоянии ветки; нет или не той формы — `undefined`. */
export function closureOfState(values: AppStateValues): ChatClosure | undefined {
  const closed = values[CLOSED_STATE_KEY];
  if (typeof closed !== "object" || closed === null) return undefined;
  const { code, message } = closed as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string" ? { code, message } : undefined;
}

/** Запись трогает закрытие (ставит или убирает `$closed`). */
export function touchesClosure(part: Part): boolean {
  if (part.type !== APP_STATE_PART_TYPE) return false;
  const data = (part as { data?: unknown }).data as { set?: unknown; unset?: unknown } | null | undefined;
  if (typeof data !== "object" || data === null) return false;
  const set = typeof data.set === "object" && data.set !== null && Object.hasOwn(data.set, CLOSED_STATE_KEY);
  return set || (Array.isArray(data.unset) && data.unset.includes(CLOSED_STATE_KEY));
}

/**
 * Служебное сообщение состояния: сообщение человека только из записей состояния (закрытие и открытие чата из кода).
 * Модели не уходит, экраном не рисуется, ходом человека не считается.
 */
export function isStateMessage(message: { role: string; parts: ReadonlyArray<{ type: string }> }): boolean {
  return message.role === "user" && message.parts.length > 0 && message.parts.every((part) => part.type === APP_STATE_PART_TYPE);
}

/** Служебное сообщение с записью в конце ветки (после `parentId`). */
export function stateMessage(fields: { chatId: string; parentId: string | null; record: AppStateRecord }): StoredMessage {
  return newStoredMessage({ id: crypto.randomUUID(), chatId: fields.chatId, parentId: fields.parentId, role: "user", parts: [appStatePart(fields.record)] });
}

/** Верхний ключ состояния, который не уходит в браузер: служебные ключи SDK и закрытые ключи приложения. */
export type HiddenStateKey = (key: string) => boolean;

/**
 * Скрытые ключи: служебные SDK (`$…`) и закрытые ключи приложения (`privateStateKeys`).
 * @throws TypeError имя пустое, начинается с `$` или содержит точку.
 */
export function hiddenStateKeyOf(privateKeys: readonly string[] | undefined): HiddenStateKey {
  if (!privateKeys || privateKeys.length === 0) return isReservedAppStateKey;
  for (const key of privateKeys) {
    if (typeof key !== "string" || key === "" || isReservedAppStateKey(key) || key.includes(".")) {
      throw new TypeError(`privateStateKeys: «${String(key)}» — нужен верхний ключ состояния без точки и не на «$»`);
    }
  }
  const closed = new Set(privateKeys);
  return (key) => isReservedAppStateKey(key) || closed.has(key);
}

/** Запись без скрытых ключей; ничего не осталось — `undefined`. Не та форма — как есть: её отбросит свёртка. */
function publicRecord(data: unknown, hidden: HiddenStateKey): unknown {
  if (typeof data !== "object" || data === null) return data;
  const { set, unset, ...rest } = data as { set?: unknown; unset?: unknown };
  const publicSet =
    typeof set === "object" && set !== null && !Array.isArray(set)
      ? Object.fromEntries(Object.entries(set).filter(([path]) => !hidden(path.split(".")[0]!)))
      : set;
  const publicUnset = Array.isArray(unset) ? unset.filter((path) => typeof path !== "string" || !hidden(path.split(".")[0]!)) : unset;
  const hasSet = publicSet !== undefined && !(typeof publicSet === "object" && publicSet !== null && Object.keys(publicSet).length === 0);
  const hasUnset = publicUnset !== undefined && !(Array.isArray(publicUnset) && publicUnset.length === 0);
  if (!hasSet && !hasUnset) return undefined;
  return { ...rest, ...(hasSet && { set: publicSet }), ...(hasUnset && { unset: publicUnset }) };
}

/** Части для браузера: из записей состояния убраны скрытые ключи, пустые записи — целиком. */
export function publicAppStateParts<P extends { type: string }>(parts: readonly P[], hidden: HiddenStateKey = isReservedAppStateKey): P[] {
  if (!parts.some((part) => part.type === APP_STATE_PART_TYPE)) return [...parts];
  return parts.flatMap((part) => {
    if (part.type !== APP_STATE_PART_TYPE) return [part];
    const data = publicRecord((part as { data?: unknown }).data, hidden);
    return data === undefined ? [] : [{ ...part, data }];
  });
}

/**
 * Сообщения для браузера: части без служебных ключей, без застывших блоков контекста и отметки `endTurn` (они только
 * для модели);
 * сообщение человека, у которого не осталось частей, не уходит. Служебное сообщение состояния (`isStateMessage`) перед
 * обычным не показывается: его открытые записи едут в начале этого сообщения, и экран сворачивает то же состояние.
 */
export function publicMessages<M extends { role: string; parts: ReadonlyArray<{ type: string }> }>(
  messages: readonly M[],
  hidden: HiddenStateKey = isReservedAppStateKey,
): M[] {
  const shown: M[] = [];
  let waiting: M[] = [];
  for (const message of messages) {
    const hasService = message.parts.some((part) => part.type === APP_STATE_PART_TYPE || isModelOnlyPart(part));
    const parts = hasService ? publicAppStateParts(message.parts.filter((part) => !isModelOnlyPart(part)), hidden) : [...message.parts];
    if (message.role === "user" && parts.length === 0) continue;
    const visible = hasService ? { ...message, parts } : message;
    if (isStateMessage(message)) {
      waiting.push(visible);
      continue;
    }
    const carried = waiting.flatMap((state) => state.parts);
    waiting = [];
    shown.push(carried.length > 0 ? { ...visible, parts: [...carried, ...visible.parts] } : visible);
  }
  // Служебные сообщения в конце ветки — нечему везти записи: уходят сами.
  return [...shown, ...waiting];
}

/** Кусок потока для браузера: запись состояния без скрытых ключей; ничего не осталось — `undefined`. */
export function publicStateChunk(chunk: UIMessageChunk, hidden: HiddenStateKey = isReservedAppStateKey): UIMessageChunk | undefined {
  if (chunk.type !== APP_STATE_PART_TYPE) return chunk;
  const data = publicRecord((chunk as { data?: unknown }).data, hidden);
  return data === undefined ? undefined : ({ ...chunk, data } as UIMessageChunk);
}

/** Части только для модели: застывшие блоки контекста и отметка конца хода инструментом без слов. */
export function isModelOnlyPart(part: { type: string }): boolean {
  return part.type === FROZEN_CONTEXT_PART_TYPE || part.type === END_TURN_PART_TYPE;
}
