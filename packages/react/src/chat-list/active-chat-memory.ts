/** Ключ, под которым запоминается открытый чат, если приложение не задало свой. */
export const defaultRememberKey = (api: string) => `agent-chat:active-chat:${api}`;

/** Чат, открытый в прошлый раз в этом браузере (под этим ключом). Хранилище недоступно или пусто — `null`. */
export function readRememberedChat(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function rememberChat(key: string, chatId: string): void {
  try {
    localStorage.setItem(key, chatId);
  } catch {
    // Приватный режим или заполненное хранилище: в следующий раз откроется самый недавний чат.
  }
}
