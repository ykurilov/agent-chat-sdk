/** Чем заменяется спрятанное значение: то же слово, что в `packages/images/src/hide-secrets.ts`. */
const HIDDEN = "[скрыто]";

/** Значения из `env` короче этого не прячутся: «dev» или «3000» встречаются в любом тексте. */
const MIN_ENV_SECRET_LENGTH = 8;
/** Пароль внутри адреса короче этого не прячется. */
const MIN_URL_PASSWORD_LENGTH = 6;
/** Переменные окружения, чьё значение — секрет, узнаются по имени. Остальные (`NODE_ENV`, `HOME`, `PORT`) не прячутся. */
const SECRET_ENV_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|AUTH|CREDENTIAL|PRIVATE/i;
/** Адрес с паролем внутри: `postgres://user:пароль@host/db`, DSN. */
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]*:([^@\s]+)@/i;
/** Значение секретного поля прячется по имени всегда; в другие места события оно переносится от этой длины. */
const MIN_FIELD_SECRET_LENGTH = 4;
const MIN_ENCODED_LENGTH = 16;

/** Имена полей, в которых лежат ключи и заголовки доступа. */
const SECRET_FIELD_NAME = /^(authorization|proxy-authorization|x-api-key|x-goog-api-key|api[-_]?key|apikey|access[-_]?token|auth[-_]?token|refresh[-_]?token|token|secret|client[-_]?secret|password|passwd|bearer|cookie|set-cookie)$/i;
const BASE64_LIKE = /^[A-Za-z0-9+/_-]+={0,2}$/;

export interface SecretHiderOptions {
  /**
   * Окружение приложения. Прячутся значения (от 8 знаков) переменных, в чьём имени есть KEY, TOKEN, SECRET, PASSWORD, PASS,
   * AUTH, CREDENTIAL или PRIVATE, и пароли внутри адресов (`postgres://user:пароль@host/db`). Остальное (`NODE_ENV`, `PORT`)
   * остаётся. По умолчанию `process.env`.
   */
  env?: Record<string, string | undefined>;
  /** Ещё значения, которые должны исчезнуть из журнала. */
  secrets?: readonly string[];
}

/** Чистка одного события: настройки запроса дают ему свои секреты (заголовки), остальное общее. */
export interface Hider {
  /** Копия значения без секретов: во всех строках и именах полей. */
  value(value: unknown): unknown;
  /** То же для настроек запроса, плюс значения секретных полей (`Authorization`, `apiKey`…) прячутся по имени. */
  settings(settings: unknown): unknown;
  /** Итоговый JSON-текст: ловит секреты, записанные в нём с экранированием (внутри JSON-строк). */
  text(text: string): string;
}

/**
 * Чистка секретов до записи в журнал и до хеширования: один и тот же ключ не оставляет следов и в хешах.
 * Прячутся значения из окружения, явно заданные значения и значения секретных полей `settings`
 * (с кавычками и экранированием, в base64 и в адресной кодировке).
 */
export function createSecretHider(options: SecretHiderOptions = {}): SecretHider {
  let fixed = unique([...secretsFromEnv(options.env ?? process.env), ...(options.secrets ?? [])]);
  // Чистильщики по набору секретов: одни и те же заголовки в каждом запросе дают один и тот же чистильщик,
  // а значит и общий кэш кусков (см. `prepareBlob`). Ссылка на объект настроек — самый быстрый путь.
  let bySettings = new WeakMap<object, Hider>();
  let bySecrets = new Map<string, Hider>();
  return {
    forSettings(settings) {
      const cached = settings !== null && typeof settings === "object" ? bySettings.get(settings) : undefined;
      if (cached) return cached;
      const secrets = unique([...fixed, ...secretFieldValues(settings)]);
      const key = secrets.join("\u0000");
      let hider = bySecrets.get(key);
      if (!hider) {
        hider = buildHider(secrets);
        if (bySecrets.size >= MAX_CACHED_HIDERS) bySecrets.delete(bySecrets.keys().next().value as string);
        bySecrets.set(key, hider);
      }
      if (settings !== null && typeof settings === "object") bySettings.set(settings, hider);
      return hider;
    },
    addSecrets(values) {
      const added = values.filter((value) => value.length > 0);
      fixed = unique([...fixed, ...added]);
      bySettings = new WeakMap();
      bySecrets = new Map();
    },
  };
}

export interface SecretHider {
  forSettings(settings: unknown): Hider;
  /** Ещё секреты, например ключи из окружения чата: действуют со следующего события. */
  addSecrets(values: readonly string[]): void;
}

const MAX_CACHED_HIDERS = 16;

/** Секреты из окружения: по именам переменных и пароли внутри адресов. */
export function secretsFromEnv(env: Record<string, string | undefined>): string[] {
  const found: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (SECRET_ENV_NAME.test(name) && value.length >= MIN_ENV_SECRET_LENGTH) found.push(value);
    const password = URL_WITH_PASSWORD.exec(value)?.[1];
    if (password && password.length >= MIN_URL_PASSWORD_LENGTH) {
      found.push(password);
      try {
        found.push(decodeURIComponent(password));
      } catch {
        // Не адресная кодировка: достаточно самого значения.
      }
      if (value.length >= MIN_ENV_SECRET_LENGTH) found.push(value);
    }
  }
  return found;
}

function buildHider(secrets: string[]): Hider {
  const raw = withVariants(secrets);
  const escaped = escapedVariants(secrets);

  function hideInString(text: string): string {
    let result = text;
    for (const secret of raw) if (result.includes(secret)) result = result.split(secret).join(HIDDEN);
    if (result.length >= MIN_ENCODED_LENGTH && BASE64_LIKE.test(result) && decodesToSecret(result, secrets)) return HIDDEN;
    return result;
  }

  function walk(value: unknown, onKey?: (key: string, child: unknown) => unknown | undefined): unknown {
    if (typeof value === "string") return hideInString(value);
    if (Array.isArray(value)) return value.map((item) => walk(item, onKey));
    if (value !== null && typeof value === "object") {
      const copy: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const replaced = onKey?.(key, child);
        copy[hideInString(key)] = replaced !== undefined ? replaced : walk(child, onKey);
      }
      return copy;
    }
    return value;
  }

  return {
    value: (value) => (secrets.length === 0 ? value : walk(value)),
    settings: (settings) => walk(settings, (key, child) => (SECRET_FIELD_NAME.test(key) && typeof child === "string" ? HIDDEN : undefined)),
    text(text) {
      let result = text;
      for (const secret of escaped) if (result.includes(secret)) result = result.split(secret).join(HIDDEN);
      return result;
    },
  };
}

/** Значения секретных полей на любой глубине; из «Bearer abc» берётся и всё значение, и «abc». */
function secretFieldValues(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) secretFieldValues(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_FIELD_NAME.test(key) && typeof child === "string") {
        const trimmed = child.trim();
        if (trimmed.length >= MIN_FIELD_SECRET_LENGTH) found.push(trimmed);
        const token = /^(?:bearer|basic|token)\s+(\S+)$/i.exec(trimmed)?.[1];
        if (token && token.length >= MIN_FIELD_SECRET_LENGTH) found.push(token);
      } else {
        secretFieldValues(child, found);
      }
    }
  }
  return found;
}

/** Само значение, его base64 и адресная кодировка. От длинных к коротким: длинное не должно остаться хвостом от короткого. */
function withVariants(secrets: string[]): string[] {
  const variants = secrets.flatMap((secret) => [secret, Buffer.from(secret).toString("base64"), encodeURIComponent(secret)]);
  return unique(variants).filter((variant) => variant.length > 0).sort((a, b) => b.length - a.length);
}

/** Значение, как оно выглядит внутри JSON-строки (один и два раза экранированное). */
function escapedVariants(secrets: string[]): string[] {
  const variants = secrets.flatMap((secret) => {
    const once = JSON.stringify(secret).slice(1, -1);
    const twice = JSON.stringify(once).slice(1, -1);
    return [secret, once, twice];
  });
  return unique(variants).sort((a, b) => b.length - a.length);
}

/** Строка похожа на base64 и после разбора содержит секрет (Basic-заголовок: `user:ключ`). */
function decodesToSecret(text: string, secrets: string[]): boolean {
  let decoded: string;
  try {
    decoded = Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return false;
  }
  return secrets.some((secret) => decoded.includes(secret));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
