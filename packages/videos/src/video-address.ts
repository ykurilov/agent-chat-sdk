// Адрес видео — площадка и код. Из них, а не из ссылки целиком, собираются адреса плеера и страницы:
// подделанная запись не превратится в чужой iframe.

export type VideoProvider = "youtube" | "kinescope";

export interface VideoAddress {
  provider: VideoProvider;
  code: string;
}

const validCode: Record<VideoProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  kinescope: /^[A-Za-z0-9_-]{4,64}$/,
};

/** Служебные страницы kinescope.io — по форме похожи на код видео, но видео не являются. */
const kinescopeServicePages = new Set([
  "about", "account", "admin", "api", "app", "assets", "auth", "blog", "careers", "cases", "company", "contacts", "dashboard",
  "developers", "docs", "education", "embed", "en", "enterprise", "faq", "features", "help", "home", "integrations", "jobs",
  "legal", "live", "login", "logout", "news", "oauth", "offer", "partners", "player", "policy", "pricing", "privacy", "product",
  "register", "ru", "security", "settings", "signin", "signup", "solutions", "static", "status", "support", "team", "terms",
  "upload", "video", "videos", "watch",
]);

const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const youtubePathPrefixes = new Set(["embed", "shorts", "live", "v"]);
const kinescopeHosts = new Set(["kinescope.io", "www.kinescope.io"]);

/** Площадка известна, код — только из допустимых знаков. */
export function isVideoAddress(value: unknown): value is VideoAddress {
  const address = value as Partial<VideoAddress> | null;
  if (typeof address?.code !== "string" || (address.provider !== "youtube" && address.provider !== "kinescope")) return false;
  if (address.provider === "kinescope" && kinescopeServicePages.has(address.code.toLowerCase())) return false;
  return validCode[address.provider].test(address.code);
}

const ROOT_CHECK_ORIGIN = "https://x.invalid";

/**
 * Обложка — `https://…` или путь от корня своего сайта. Браузер читает `/\evil`, `/<таб>/evil` как `//evil` — чужой хост,
 * поэтому путь разбирается как адрес и обязан остаться на своём хосте; `\`, пробелы, управляющие знаки и закодированные
 * косые не допускаются вовсе.
 */
export function isPosterAddress(value: unknown): value is string {
  if (typeof value !== "string" || /[\\\s\u0000-\u001f\u007f]|%2f|%5c/i.test(value)) return false;
  try {
    if (value.startsWith("/")) return new URL(value, ROOT_CHECK_ORIGIN).origin === ROOT_CHECK_ORIGIN;
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function checked(provider: VideoProvider, code: string | null | undefined): VideoAddress | undefined {
  const address = { provider, code: code ?? "" };
  return isVideoAddress(address) ? address : undefined;
}

/** Ссылка YouTube (watch, youtu.be, embed, shorts, live) или Kinescope (`/<код>`, `/embed/<код>`) → площадка и код. */
export function parseVideoUrl(url: string): VideoAddress | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") return segments.length === 1 ? checked("youtube", segments[0]) : undefined;
  if (youtubeHosts.has(host)) {
    if (segments.length === 1 && segments[0] === "watch") return checked("youtube", parsed.searchParams.get("v"));
    if (segments.length === 2 && youtubePathPrefixes.has(segments[0]!)) return checked("youtube", segments[1]);
    return undefined;
  }
  if (kinescopeHosts.has(host)) {
    if (segments.length === 1 && segments[0] !== "embed") return checked("kinescope", segments[0]);
    if (segments.length === 2 && segments[0] === "embed") return checked("kinescope", segments[1]);
  }
  return undefined;
}

const startSecond = (startSeconds: number | undefined) =>
  startSeconds !== undefined && Number.isInteger(startSeconds) && startSeconds > 0 ? startSeconds : undefined;

/** Адрес встроенного плеера: YouTube — с youtube-nocookie.com; оба с автозапуском (грузится по нажатию) и стартом. */
export function embedUrl(address: VideoAddress, startSeconds?: number): string {
  const start = startSecond(startSeconds);
  if (address.provider === "youtube") {
    return `https://www.youtube-nocookie.com/embed/${address.code}?autoplay=1&playsinline=1&rel=0${start ? `&start=${start}` : ""}`;
  }
  return `https://kinescope.io/embed/${address.code}?autoplay=1&playsinline=1${start ? `&t=${start}` : ""}`;
}

/** Адрес страницы видео на площадке — для ссылки, когда скин не умеет карточку. */
export function watchUrl(address: VideoAddress, startSeconds?: number): string {
  const start = startSecond(startSeconds);
  if (address.provider === "youtube") return `https://www.youtube.com/watch?v=${address.code}${start ? `&t=${start}s` : ""}`;
  return `https://kinescope.io/${address.code}${start ? `?t=${start}` : ""}`;
}
