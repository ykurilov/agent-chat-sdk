import { appDomainsOf, isAppNameHost } from "./app-domains";

// Ссылки в ответе. Давать можно только те, что есть в знакомых текстах (инструкция, сценарий, реплики человека).
// Выдуманный или изменённый адрес уводит человека в никуда.

/** http(s)://, www.…, домен с путём (t.me/…, bit.ly/…). Почта и @имена — не ссылки: перед доменом нет «@». */
const LINK = /(?:https?:\/\/|(?<![\p{L}\d@.\/-])www\.)[^\s<>«»"'()]+|(?<![\p{L}\d@.\/-])(?:[\p{L}\d-]+\.)+(?:[a-z]{2,6}|рф)\/[^\s<>«»"'()]*/giu;

/** Знаки препинания в конце — от фразы, а не от ссылки. */
const TRAILING = /[.,!?;:…]+$/u;

/** Ссылки текста по порядку появления. */
export function linksIn(text: string): string[] {
  return (text.match(LINK) ?? []).map((link) => link.replace(TRAILING, "")).filter(Boolean);
}

/** Адрес без схемы, «www.» и косой черты в конце; домен — без учёта регистра: «https://A.ru/x» и «a.ru/x» — одна ссылка. */
function sameAddress(link: string): string {
  const bare = link.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
  const slash = bare.indexOf("/");
  return slash < 0 ? bare.toLowerCase() : bare.slice(0, slash).toLowerCase() + bare.slice(slash);
}

// Голый адрес в знакомом тексте: человек пишет «sveta-nails.apps.example.com» без https:// и без пути
const BARE_HOST = /(?<![\p{L}\p{N}@./-])(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?![\p{L}\p{N}/-])/giu;

/**
 * Ссылки ответа, которых нет в знакомых текстах. Законны и голые адреса из них, и короткий адрес приложения:
 * имя из знакомых текстов на домене приложений (заданном настройкой или описанном шаблоном «адрес.apps.example.com»).
 */
export function unknownLinksIn(text: string, known: readonly string[], appDomains: readonly string[] = []): string[] {
  const allowed = new Set([...known.flatMap(linksIn), ...known.flatMap((one) => one.match(BARE_HOST) ?? [])].map(sameAddress));
  const domains = appDomainsOf(known, appDomains);
  return linksIn(text).filter((link) => {
    const address = sameAddress(link);
    return !allowed.has(address) && !(!address.includes("/") && isAppNameHost(address, domains, known));
  });
}

/** Ссылки вырезаются вместе с подводкой «: » перед ними; лишние пробелы перед знаками убираются. */
export function withoutLinks(text: string, links: readonly string[]): string {
  let result = text;
  for (const link of links) result = result.split(link).join("\u0000");
  return result
    .replace(/\s*:?\s*\u0000/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?;:…])/g, "$1")
    .trim();
}
