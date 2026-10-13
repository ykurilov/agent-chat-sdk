import { useCallback, useSyncExternalStore } from "react";

/** Под этим ключом `localStorage` помнит, открыта ли панель: `{ "open": boolean }`. */
export const panelOpenKey = (api: string, userKey: string) => `agent-chat:panel:${api}:${userKey}`;

/** Под этим ключом `useChatList` помнит чат, открытый в панели у этого человека. */
export const panelChatKey = (api: string, userKey: string) => `agent-chat:panel-chat:${api}:${userKey}`;

/** Состояние, которое не записалось в хранилище (недоступно или переполнено): живёт в памяти страницы и главнее записанного раньше. */
const unsaved = new Map<string, boolean>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Была ли панель открыта у этого человека. Нет записи, битая запись или хранилище недоступно — закрыта. */
export function readPanelOpen(api: string, userKey: string): boolean {
  const key = panelOpenKey(api, userKey);
  const kept = unsaved.get(key);
  if (kept !== undefined) return kept;
  try {
    return parseOpen(localStorage.getItem(key));
  } catch {
    return false;
  }
}

export function rememberPanelOpen(api: string, userKey: string, open: boolean): void {
  const key = panelOpenKey(api, userKey);
  try {
    localStorage.setItem(key, JSON.stringify({ open }));
    unsaved.delete(key);
  } catch {
    unsaved.set(key, open);
  }
  for (const listener of [...listeners]) listener();
}

/**
 * Открыта ли панель у этого человека; смена `api` или `userKey` — его запомненное состояние.
 * При отрисовке на сервере и в первом проходе гидратации — закрыта, потом — запомненное: разметка не расходится.
 */
export function usePanelOpen(api: string, userKey: string): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, () => readPanelOpen(api, userKey), () => false);
  const setOpen = useCallback((next: boolean) => rememberPanelOpen(api, userKey, next), [api, userKey]);
  return [open, setOpen];
}

function parseOpen(stored: string | null): boolean {
  try {
    const value: unknown = JSON.parse(stored ?? "null");
    return typeof value === "object" && value !== null && (value as { open?: unknown }).open === true;
  } catch {
    return false;
  }
}
