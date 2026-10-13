import { useCallback, useMemo, useSyncExternalStore } from "react";

/*
 * Раскрытые рассуждения и строки вызовов. Живут не в самих строках, а в хранилище на чат:
 * лента размонтирует сообщения, ушедшие за край экрана, а раскрытое должно пережить уход.
 */

export interface ExpandedParts {
  isOpen: (key: string) => boolean;
  setOpen: (key: string, open: boolean) => void;
  subscribe: (listener: () => void) => () => void;
}

/** Ключ части ответа: id сообщения и номер части. */
export function partKey(messageId: string, partIndex: number): string {
  return `${messageId}:${partIndex}`;
}

function createExpandedParts(): ExpandedParts {
  const open = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    isOpen: (key) => open.has(key),
    setOpen: (key, next) => {
      if (open.has(key) === next) return;
      if (next) open.add(key);
      else open.delete(key);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Хранилище раскрытых частей одного чата; при смене `chatId` начинается пустое. */
export function useExpandedParts(chatId: string): ExpandedParts {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- новый чат — новое хранилище
  return useMemo(createExpandedParts, [chatId]);
}

/** Раскрыта ли часть и как её переключить; часть перерисовывается только от своего ключа. */
export function usePartOpen(store: ExpandedParts, key: string): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.isOpen(key),
    () => false,
  );
  const setOpen = useCallback((next: boolean) => store.setOpen(key, next), [store, key]);
  return [open, setOpen];
}
