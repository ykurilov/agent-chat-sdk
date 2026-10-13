// Копия packages/core/src/request-origin/request-origin.ts: голосовой пакет живёт без зависимостей. Правьте обе вместе.
/**
 * Защита от запросов с чужих страниц. Браузер сам прикладывает к запросу куки человека, даже если запрос
 * отправила чужая страница (обычная HTML-форма, WebSocket). Отличить свою страницу от чужой помогают заголовки,
 * которые ставит только браузер: `Sec-Fetch-Site` и `Origin`. Порядок проверки как в Go 1.25 (CrossOriginProtection).
 */

export interface RequestOriginCheckOptions {
  /**
   * Чужие страницы, которым можно слать запросы с куками человека, например `["https://school.getcourse.ru"]`
   * (схема, хост, порт). Шаблон `https://*.example.com` пускает все поддомены `example.com`, но не сам домен
   * и не `evil-example.com`. Свой сайт в список вносить не нужно.
   */
  allowedOrigins?: readonly string[] | undefined;
  /** Отказ: вызывается один раз на каждый новый адрес страницы, чтобы журнал не забивался. */
  onRefused?: (refusal: OriginRefusal) => void;
}

/**
 * Почему запрос отклонён. `cross_site` — браузер сам сказал, что страница чужая. `host_mismatch` — браузер старый
 * или адрес не https, и Origin не совпал ни с одним именем сервера (`hosts`): так бывает за прокси, который подменил Host.
 */
export type OriginRefusal = { origin: string; reason: "cross_site" } | { origin: string; reason: "host_mismatch"; hosts: string[] };

/** Подсказка для журнала: что поправить, если отклонена своя страница. */
export function originRefusalHint(refusal: OriginRefusal): string {
  if (refusal.reason === "host_mismatch") {
    return (
      `отклонён запрос со страницы ${refusal.origin}: Origin не совпал с Host (${refusal.hosts.join(", ")}). ` +
      "Если сервер за прокси, за прокси передайте Host/X-Forwarded-Host (nginx: proxy_set_header Host $host; " +
      "proxy_set_header X-Forwarded-Host $host;). Если это чужая для сервера, но ваша страница, добавьте её адрес в allowedOrigins."
    );
  }
  return `отклонён запрос с чужой страницы ${refusal.origin}. Если это ваша страница, добавьте её адрес в allowedOrigins.`;
}

/** `true` — запрос со своей страницы, со страницы из списка или не из браузера. Метод запроса не смотрит. */
export type RequestOriginCheck = (request: Request) => boolean;

/** Чтения (GET, HEAD, OPTIONS) не меняют данных: их ответ браузер чужой странице всё равно не покажет. */
export function isSafeMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "GET" || upper === "HEAD" || upper === "OPTIONS";
}

/** Сколько разных отклонённых адресов запоминается для журнала. */
const MAX_REPORTED_ORIGINS = 100;
const MAX_REPORTED_LENGTH = 200;

export function createRequestOriginCheck(options: RequestOriginCheckOptions = {}): RequestOriginCheck {
  const isAllowed = allowedOriginsMatcher(options.allowedOrigins ?? []);
  const reported = new Set<string>();
  const refuse = (refusal: OriginRefusal): false => {
    const shown = refusal.origin.slice(0, MAX_REPORTED_LENGTH);
    if (options.onRefused && !reported.has(shown) && reported.size < MAX_REPORTED_ORIGINS) {
      reported.add(shown);
      options.onRefused({ ...refusal, origin: shown });
    }
    return false;
  };
  return (request) => {
    const origin = request.headers.get("origin");
    if (origin !== null && isAllowed(origin)) return true;
    const site = request.headers.get("sec-fetch-site");
    if (site !== null) {
      if (site === "same-origin" || site === "none") return true;
      return refuse({ origin: origin ?? `(без Origin, Sec-Fetch-Site: ${site})`, reason: "cross_site" });
    }
    // Нет ни того ни другого — не браузер (сервер, curl): куки человека чужая страница так не приложит.
    if (origin === null) return true;
    // Старый браузер без Sec-Fetch-Site: Origin должен совпасть с адресом самого сервера.
    const host = originHost(origin);
    const hosts = hostsOf(request);
    if (host !== null && hosts.has(host)) return true;
    return refuse({ origin, reason: "host_mismatch", hosts: [...hosts] });
  };
}

/** Метка вместо `*`: адрес с ней разбирает URL, а в настоящем имени хоста она не встречается. */
const WILDCARD_LABEL = "wildcard-label-0";

/** Точные адреса и шаблоны поддоменов из `allowedOrigins`; неверная запись — ошибка сразу. */
function allowedOriginsMatcher(entries: readonly string[]): (origin: string) => boolean {
  const exact = new Set<string>();
  const subdomainsOf: Array<{ protocol: string; port: string; suffix: string }> = [];
  for (const entry of entries) {
    const wildcard = /^(https?:\/\/)\*\.([^*]+)$/.exec(entry);
    const url = parsePageAddress(wildcard ? `${wildcard[1]}${WILDCARD_LABEL}.${wildcard[2]}` : entry);
    if (url === null || (!wildcard && entry.includes("*"))) throw wrongEntry(entry);
    if (!wildcard) {
      exact.add(url.origin);
      continue;
    }
    const suffix = url.hostname.slice(WILDCARD_LABEL.length);
    // `*.com` пустил бы весь интернет: после звёздочки нужен домен хотя бы из двух частей (или localhost).
    // Точка в конце (`*.com.`) — тот же `*.com`. Общие суффиксы вроде `*.co.uk` так не отличить: вписывают свой домен.
    const tooBroad = suffix.endsWith(".") || (!suffix.slice(1).includes(".") && suffix !== ".localhost");
    if (!url.hostname.startsWith(`${WILDCARD_LABEL}.`) || tooBroad) throw wrongEntry(entry);
    subdomainsOf.push({ protocol: url.protocol, port: url.port, suffix });
  }
  return (origin) => {
    const url = parseOrigin(origin);
    if (url === null) return false;
    if (exact.has(url.origin)) return true;
    return subdomainsOf.some(
      (pattern) =>
        url.protocol === pattern.protocol && url.port === pattern.port && url.hostname.endsWith(pattern.suffix) && url.hostname.length > pattern.suffix.length,
    );
  };
}

/** Адрес страницы: http(s), без пути, запроса, якоря и имени пользователя. Иначе `null`. */
function parsePageAddress(entry: string): URL | null {
  try {
    const url = new URL(entry);
    const bare = url.pathname === "/" && !url.search && !url.hash && !url.username;
    return (url.protocol === "http:" || url.protocol === "https:") && bare ? url : null;
  } catch {
    return null;
  }
}

function wrongEntry(entry: string): Error {
  return new Error(
    `allowedOrigins: «${entry}» не адрес страницы; нужен вид https://app.example, http://localhost:5173 или https://*.example.com ` +
      "(в шаблоне — свой домен: общие суффиксы вроде *.co.uk проверка не распознаёт)",
  );
}

function parseOrigin(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

/** Хост с портом из Origin; `null` и не адрес — `null`. */
function originHost(origin: string): string | null {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

/**
 * Под какими именами сервер знает себя: `Host` и `X-Forwarded-Host` от прокси. Адрес запроса — только без `Host`:
 * при подъёме WebSocket в Node (`@hono/node-ws`) он собран как `http://localhost/…` и порта в нём нет.
 */
function hostsOf(request: Request): Set<string> {
  const host = request.headers.get("host");
  const hosts = new Set<string>([host ? host.trim().toLowerCase() : new URL(request.url).host]);
  for (const forwarded of request.headers.get("x-forwarded-host")?.split(",") ?? []) {
    if (forwarded.trim()) hosts.add(forwarded.trim().toLowerCase());
  }
  return hosts;
}
