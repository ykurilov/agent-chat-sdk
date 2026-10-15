// Адрес картинки из каталога: путь от корня своего сайта или https на домене, который приложение разрешило явно.
// Проверка общая для сервера и экрана: подделанная запись в базе не уведёт картинку на чужой хост.

const ROOT_CHECK_ORIGIN = "https://x.invalid";

/**
 * `/…` — свой сайт: браузер читает `/\evil`, `/<таб>/evil` как `//evil`, поэтому путь разбирается как адрес и обязан
 * остаться на своём хосте; `\`, пробелы, управляющие знаки и закодированные косые не допускаются. `https://…` —
 * только на хосте из `allowedHosts` (сравнение без регистра, без поддоменов), без логина и пароля в адресе.
 */
export function isImageAddress(value: unknown, allowedHosts: readonly string[]): value is string {
  if (typeof value !== "string" || value === "" || /[\\\s\u0000-\u001f\u007f]|%2f|%5c/i.test(value)) return false;
  try {
    if (value.startsWith("/")) return new URL(value, ROOT_CHECK_ORIGIN).origin === ROOT_CHECK_ORIGIN;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
    const host = url.hostname.toLowerCase();
    return allowedHosts.some((allowed) => allowed.toLowerCase() === host);
  } catch {
    return false;
  }
}
