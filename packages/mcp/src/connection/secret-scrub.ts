/** Короче — не вычищаем: «a» в тексте ошибки не секрет, а замена испортит текст. */
const MIN_SECRET_LENGTH = 4;
/** Предел текста ошибки сервера: длинное тело ответа в журнал и модели не нужно. */
export const ERROR_MAX_CHARS = 300;

/**
 * Вычистка секретов из текста ошибки: адрес целиком меняется на адрес без параметров, значения параметров адреса и
 * заголовков (и их вид в адресной строке) — на «***». Длинное обрезается.
 */
export function secretScrubber(input: { url: URL; displayUrl: string; headerValues: readonly string[] }): (text: string) => string {
  const { url } = input;
  const values = [url.search.slice(1), url.hash.slice(1), ...url.searchParams.values(), url.username, url.password, ...input.headerValues]
    .flatMap((value) => [value, encodeURIComponent(value), value.replace(/^Bearer\s+/i, "")])
    .filter((value) => value.length >= MIN_SECRET_LENGTH);
  const secrets = [...new Set(values)].sort((a, b) => b.length - a.length);
  const fullAddresses = [url.href, url.href.replace(/\/$/, "")].filter((href) => href !== input.displayUrl);

  return (text) => {
    let clean = text;
    for (const href of fullAddresses) clean = clean.split(href).join(input.displayUrl);
    for (const secret of secrets) clean = clean.split(secret).join("***");
    return clean.length > ERROR_MAX_CHARS ? `${clean.slice(0, ERROR_MAX_CHARS - 1)}…` : clean;
  };
}
