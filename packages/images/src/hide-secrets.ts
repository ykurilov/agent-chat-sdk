/** Значения короче этого не прячутся: «1» или «on» встречаются в любом тексте. */
const MIN_SECRET_LENGTH = 4;

/** Текст без ключа провайдера и значений заголовков подключения (прокси): для ошибок, итога вызова и журнала. */
export function hideSecrets(text: string, connection: { apiKey?: string; headers?: Record<string, string> }): string {
  const secrets = [connection.apiKey, ...Object.values(connection.headers ?? {})]
    .filter((value): value is string => typeof value === "string" && value.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  return secrets.reduce((result, secret) => result.split(secret).join("[скрыто]"), text);
}
