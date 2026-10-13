const SAFE_SESSION_ID = /^[A-Za-z0-9._:~-]{1,128}$/;

/**
 * Номер чата для заголовка привязки к одному серверу провайдера (`x-session-id`, `x-session-affinity`). Обычный номер
 * (UUID, латиница с цифрами и `._:~-` до 128 знаков) идёт как есть. Кириллица, пробелы, переводы строк и слишком длинные
 * номера дали бы запрос, который провайдер или `fetch` отвергнет, поэтому такой номер заменяется короткой стойкой
 * свёрткой: у одного чата значение всегда то же, у разных чатов — разное.
 */
export function sessionHeaderValue(chatId: string): string {
  return SAFE_SESSION_ID.test(chatId) ? chatId : `chat-${hashOf(chatId)}`;
}

/** Свёртка cyrb53: 53 бита, одинаковая в любой среде (без `node:crypto`, потому что запрос собирается синхронно). */
function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
