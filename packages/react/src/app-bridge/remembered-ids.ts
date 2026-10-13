/** Последние id, которые помнит вкладка: в `sessionStorage` под `key` (переживают перезагрузку), без хранилища — на время жизни страницы. */
export interface RememberedIds {
  /** Отмечает id; `false` — он уже отмечен. */
  claim(id: string): boolean;
}

export function rememberedIds(key: string, limit: number): RememberedIds {
  /** Отмеченные id, если `sessionStorage` недоступен. */
  let pageIds: string[] = [];

  const read = (): string[] => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return pageIds;
    }
  };

  const write = (ids: string[]) => {
    pageIds = ids;
    try {
      sessionStorage.setItem(key, JSON.stringify(ids));
    } catch {
      // Приватный режим: помнит только эта страница.
    }
  };

  return {
    claim(id) {
      const ids = read();
      if (ids.includes(id)) return false;
      write([...ids, id].slice(-limit));
      return true;
    },
  };
}
