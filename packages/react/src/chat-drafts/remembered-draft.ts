import { useEffect, useRef } from "react";

// Черновик чата в localStorage браузера: набранный, но не отправленный текст переживает перезагрузку страницы.
// Свой ключ у каждого чата (адрес обработчика + id чата). Хранилище закрыто или переполнено — черновик живёт как раньше,
// только пока открыт экран.

/** Сколько хранится черновик, к которому не возвращались. Старше — при открытии чата удаляется. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const draftKey = (api: string, chatId: string) => `agent-chat:draft:${api}:${chatId}`;

interface StoredDraft {
  text: string;
  savedAt: number;
}

export function readDraft(key: string, now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const draft = parsed as Partial<StoredDraft> | null;
    if (typeof draft?.text !== "string" || typeof draft.savedAt !== "number" || now - draft.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return draft.text.length > 0 ? draft.text : null;
  } catch {
    return null;
  }
}

/** Пустой текст (отправили, стёрли) убирает черновик. */
export function writeDraft(key: string, text: string, now = Date.now()): void {
  try {
    if (text.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ text, savedAt: now } satisfies StoredDraft));
  } catch {
    // Приватный режим или переполнено: черновик просто не запоминается.
  }
}

/**
 * Помнит черновик открытого чата. Восстанавливает после показа (на сервере и при гидратации поле то же, что без
 * черновика), только если приложение не задало свой `initialDraft` и поле ещё пустое. Пишет при каждой смене текста.
 */
export function useRememberedDraft({
  enabled,
  api,
  chatId,
  value,
  setValue,
  hasInitialDraft,
}: {
  enabled: boolean;
  api: string;
  chatId: string;
  value: string;
  setValue: (value: string) => void;
  hasInitialDraft: boolean;
}): void {
  const key = draftKey(api, chatId);
  const current = useRef(value);
  current.current = value;
  const seen = useRef(value);
  const set = useRef(setValue);
  set.current = setValue;

  useEffect(() => {
    if (!enabled || hasInitialDraft) return;
    const text = readDraft(key);
    if (text !== null && current.current.length === 0) set.current(text);
    // Только при открытии чата: дальше текст ведёт человек.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  useEffect(() => {
    if (value === seen.current) return;
    seen.current = value;
    if (enabled) writeDraft(key, value);
  }, [enabled, key, value]);
}
