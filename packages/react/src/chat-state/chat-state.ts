import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/** Состояние чата: значения, записанные инструментами (`model.state`), без служебных ключей SDK. */
export type ChatStateValues = Record<string, unknown>;

export const APP_STATE_PART_TYPE = "data-app-state";
const EMPTY: ChatStateValues = Object.freeze({}) as ChatStateValues;

/** Служебный ключ SDK (`$closed`): экрану не нужен, сервер его и не присылает. */
const isReservedPath = (path: string): boolean => path.startsWith("$");

const isObject = (value: unknown): value is ChatStateValues => typeof value === "object" && value !== null && !Array.isArray(value);

/** Свёртка записей состояния показанной ветки по порядку: в записи сначала `unset`, потом `set`. */
export function foldChatState(messages: ReadonlyArray<{ parts: ReadonlyArray<{ type: string }> }>): ChatStateValues {
  let values: ChatStateValues | undefined;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== APP_STATE_PART_TYPE) continue;
      const record = (part as { data?: unknown }).data;
      if (!isObject(record)) continue;
      values ??= {};
      applyRecord(values, record);
    }
  }
  return values ?? EMPTY;
}

function applyRecord(values: ChatStateValues, record: ChatStateValues): void {
  const unset = Array.isArray(record.unset) ? record.unset : [];
  for (const path of unset) {
    if (typeof path !== "string" || isReservedPath(path)) continue;
    const keys = path.split(".");
    let parent: unknown = values;
    for (const key of keys.slice(0, -1)) parent = isObject(parent) && Object.hasOwn(parent, key) ? parent[key] : undefined;
    if (isObject(parent)) delete parent[keys.at(-1)!];
  }
  const set = isObject(record.set) ? record.set : {};
  for (const [path, value] of Object.entries(set)) {
    if (isReservedPath(path)) continue;
    const keys = path.split(".");
    let target = values;
    for (const key of keys.slice(0, -1)) {
      if (!isObject(target[key])) target[key] = {};
      target = target[key] as ChatStateValues;
    }
    target[keys.at(-1)!] = structuredClone(value);
  }
}

/** Состояние из события сервера (`state-changed`): объект без служебных ключей; не объект — `null`. */
export function chatStateOfEvent(state: unknown): ChatStateValues | null {
  if (!isObject(state)) return null;
  return Object.fromEntries(Object.entries(state).filter(([key]) => !isReservedPath(key)));
}

/** Одинаковые ли состояния: то же значение не перерисовывает экран и не зовёт `onStateChange` повторно. */
export const sameChatState = (a: ChatStateValues, b: ChatStateValues): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

export const ChatStateContext = createContext<ChatStateValues>(EMPTY);

/** Чат на странице, который публикует своё состояние: последний опубликованный — главный. */
type Publisher = { values: ChatStateValues };

/**
 * Состояние открытых на странице чатов по `chatId`: его публикует `useAgentChat` после загрузки истории, читают панели
 * вне `AgentChat`. Своих запросов нет: источник один — лента чата.
 */
const published = new Map<string, Publisher[]>();
const listeners = new Map<string, Set<() => void>>();

const notify = (chatId: string) => listeners.get(chatId)?.forEach((listener) => listener());

const publishedState = (chatId: string): ChatStateValues => published.get(chatId)?.at(-1)?.values ?? EMPTY;

/** Публикует состояние чата для `useChatState(chatId)`; возвращает смену значения и снятие с публикации. */
export function publishChatState(chatId: string, values: ChatStateValues): { update(values: ChatStateValues): void; remove(): void } {
  const publisher: Publisher = { values };
  published.set(chatId, [...(published.get(chatId) ?? []), publisher]);
  notify(chatId);
  return {
    update(next) {
      if (publisher.values === next) return;
      publisher.values = next;
      notify(chatId);
    },
    remove() {
      const rest = (published.get(chatId) ?? []).filter((candidate) => candidate !== publisher);
      if (rest.length > 0) published.set(chatId, rest);
      else published.delete(chatId);
      notify(chatId);
    },
  };
}

function subscribe(chatId: string, listener: () => void): () => void {
  const set = listeners.get(chatId) ?? new Set();
  set.add(listener);
  listeners.set(chatId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(chatId);
  };
}

/**
 * Состояние чата показанной ветки, без служебных ключей. Без аргумента — внутри `AgentChat` (компоненты скина, виджеты,
 * свои кнопки): живьём по ходу ответа и после смены ветки; вне `AgentChat` — пустое; с `useAgentChat` — поле
 * `chatState`. С `chatId` — где угодно на странице (панель рядом с чатом): то же состояние, что у `AgentChat` или
 * `useAgentChat` этого чата на странице, с теми же живыми обновлениями и без своих запросов. Чата на странице нет или
 * его история ещё грузится — пустое.
 */
export function useChatState(chatId?: string): ChatStateValues {
  const inChat = useContext(ChatStateContext);
  const key = chatId ?? "";
  const subscribeToChat = useCallback((listener: () => void) => (chatId === undefined ? () => {} : subscribe(key, listener)), [chatId, key]);
  const getSnapshot = useCallback(() => (chatId === undefined ? EMPTY : publishedState(key)), [chatId, key]);
  const outside = useSyncExternalStore(subscribeToChat, getSnapshot, getSnapshot);
  return chatId === undefined ? inChat : outside;
}
