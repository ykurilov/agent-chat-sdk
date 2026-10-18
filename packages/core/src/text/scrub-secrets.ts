import type { ModelCatalog } from "../models/model-catalog";

/** Короче этого известный секрет не вычищается: короткая строка совпала бы с обычными словами. */
export const MIN_SECRET_LENGTH = 8;
const HIDDEN = "[скрыто]";

/**
 * Имя поля, значение которого — секрет: `password`, `client_secret`, `accessToken`, `api_key`, `X-Api-Key`…
 * Имя кончается на этом слове: `max_tokens`, `token_count`, `secret_mode` — не секреты.
 */
const SECRET_FIELD = String.raw`[\w-]*(?:password|passwd|secret|token|api[_-]?key|(?:secret|private|access)[_-]?key)(?![\w-])`;
/** Значение поля: в кавычках целиком или до разделителя. Число — не секрет (`token=5`, `max_tokens=0`). */
const FIELD_VALUE = String.raw`(?!\d+(?![^&\s"',;]))(?:"[^"]*"|'[^']*'|[^&\s"',;]+)`;

/**
 * Значение, похожее на секрет: от 8 знаков без пробелов, есть и буква, и цифра. Так `token limit`, `key expired` и
 * `primary key=id` остаются как есть.
 */
const SECRET_LIKE = String.raw`(?=[^\s"',;]*\d)(?=[^\s"',;]*[A-Za-z])[^\s"',;]{8,}`;

/** Узнаваемые ключи сервисов: маски со звёздочками (`sk-proj-****abcd`), OpenAI и похожие, Stripe, GitHub, Slack, AWS, Google, Hugging Face, Groq, npm, SendGrid, JWT, PEM. */
const KNOWN_KEY_PATTERNS = [
  // Маска ключа целиком: провайдер показывает начало и последние знаки ключа.
  /[\w-]*\*{4,}[\w-]*/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b[spr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bgsk_[A-Za-z0-9]{20,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bSG\.[\w-]{16,}\.[\w-]{16,}/g,
  /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g,
];

/**
 * Пароль в адресе `схема://логин:пароль@хост`. В пароле могут быть `@` и `/`: он тянется до того `@`,
 * за которым идёт хост и конец адреса или его путь. `@` дальше в пути (`?email=a@b`) пароль не продлевает.
 */
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]*):\S*?@(?=[\w.-]+(?::\d+)?(?:[/?#\s]|$))/gi;

/**
 * Вычищает секреты из текста, который уходит человеку, в базу, в журнал или модели: известные значения
 * (`knownSecrets`, например ключи провайдеров из окружения), пароль в адресе `схема://логин:пароль@`,
 * заголовок `Authorization`, `Bearer …` в любом регистре, `key=…`, поля вроде `password=…`, `password: …` и `"token": "…"`,
 * слово ключа через пробел перед похожим на секрет значением (`token abc123def456`), узнаваемые ключи сервисов и их
 * маски со звёздочками.
 */
export function scrubSecrets(text: string, knownSecrets: Iterable<string | undefined> = []): string {
  let scrubbed = text;
  for (const secret of new Set(knownSecrets)) {
    if (secret && secret.length >= MIN_SECRET_LENGTH) scrubbed = scrubbed.split(secret).join(HIDDEN);
  }
  for (const pattern of KNOWN_KEY_PATTERNS) scrubbed = scrubbed.replace(pattern, HIDDEN);
  return scrubbed
    .replace(URL_PASSWORD, `$1:${HIDDEN}@`)
    .replace(/\b((?:Proxy-)?Authorization\s*[:=]\s*)(?:(Basic|Bearer|Token|Digest)\s+)?[^\s"',;]+/gi, (_, head: string, scheme?: string) => `${head}${scheme ? `${scheme} ` : ""}${HIDDEN}`)
    .replace(/\b(Bearer\s+)(?!\[скрыто\])[^\s"',;]+/gi, `$1${HIDDEN}`)
    .replace(/([?&;]key=)[^&\s"]+/g, `$1${HIDDEN}`)
    .replace(new RegExp(String.raw`(?<![\w-])(key\s*[:=]\s*)${SECRET_LIKE}`, "gi"), `$1${HIDDEN}`)
    .replace(new RegExp(String.raw`(?<![\w-])((?:token|api[_-]?key|secret|password|passwd|key)\s+)${SECRET_LIKE}`, "gi"), `$1${HIDDEN}`)
    .replace(new RegExp(String.raw`("${SECRET_FIELD}"\s*:\s*)"[^"]*"`, "gi"), `$1"${HIDDEN}"`)
    .replace(new RegExp(String.raw`(?<![\w-])(${SECRET_FIELD}\s*[:=]\s*)(?!"\[скрыто\]")(${FIELD_VALUE})`, "gi"), (_, head: string, value: string) =>
      /^["']/.test(value) ? `${head}${value[0]}${HIDDEN}${value[0]}` : `${head}${HIDDEN}`,
    );
}

/** Имя переменной окружения, в которой лежит секрет: `FIRECRAWL_API_KEY`, `DB_PASSWORD`, `BOT_TOKEN`… */
const SECRET_ENV_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)(?:_|$)/i;

/**
 * Значение переменной с «секретным» именем, которое на секрет не похоже: путь (`KEY_PATH=/etc/ssl/key.pem`),
 * адрес без пароля (`TOKEN_URL=https://…`), одно слово из букв (`SECRET_MODE=production`). Такое значение,
 * вычищенное из текста ошибки, только испортило бы её.
 */
function looksPlain(value: string): boolean {
  return /^(?:\/|\.{1,2}\/|~\/|[a-z]:\\)/i.test(value) || /^[a-z][a-z0-9+.-]*:\/\/[^\s@]*$/i.test(value) || /^[a-z]+$/i.test(value);
}

/**
 * Секреты сервера: ключи всех провайдеров каталога, значения заголовков их подключения (токен прокси)
 * и переменные окружения с секретом в имени (кроме значений, не похожих на секрет).
 */
export function environmentSecrets(env: Record<string, string | undefined>, catalog: ModelCatalog): string[] {
  const providerKeyNames = new Set(catalog.providers.map((provider) => provider.apiKeyEnv));
  const connectionSecrets = catalog.providers.flatMap((provider) => Object.values(provider.connection?.headers ?? {}));
  const fromEnv = Object.entries(env).flatMap(([name, value]) => {
    if (!value) return [];
    if (providerKeyNames.has(name)) return [value];
    return SECRET_ENV_NAME.test(name) && !looksPlain(value) ? [value] : [];
  });
  return [...fromEnv, ...connectionSecrets];
}
