import { WebToolError } from "./web-tool-error";

const notPublicMessage = "Адрес локальный или частный: такие страницы читать нельзя.";
const unresolvedMessage = "Адрес не открылся: имя не разрешилось.";

/** Определяет адреса имени. В приложении это DNS; в тестах подменяется. */
export type HostResolver = (hostname: string) => Promise<string[]>;

/** Адрес http или https: единственные схемы, которые пускают в результаты и в скачивание. */
export function isHttpAddress(address: string): boolean {
  try {
    const { protocol } = new URL(address);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Пропускает только публичные адреса http и https: сервис чтения не должен ходить во внутреннюю сеть. */
export function assertPublicWebAddress(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new WebToolError("bad_address", "Неверный адрес страницы: нужен полный адрес с http:// или https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebToolError("bad_address", "Неверный адрес страницы: поддерживаются только http:// и https://.");
  }
  if (url.username || url.password) {
    throw new WebToolError("bad_address", "Адрес с логином и паролем не поддерживается.");
  }
  if (isLocalHost(url.hostname)) throw new WebToolError("bad_address", notPublicMessage);
  return url;
}

/**
 * Проверка по DNS перед запросом — для `fetch` приложения (свой прокси), который сам разрешает имя: если хоть один
 * адрес частный (или имя не разрешилось), имя отклоняется. Адрес-число уже проверен `assertPublicWebAddress`.
 * Между проверкой и запросом остаётся окно: такой `fetch` разрешает имя ещё раз. Закрепить ответ DNS за соединением
 * может только сам `fetch`: встроенный — `createPinnedFetch`, у своего `fetch` приложения это его забота.
 */
export async function assertResolvesPublic(url: URL, resolveHost: HostResolver): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return;
  await checkedAddresses(hostname, resolveHost, false);
}

/** Адреса имени по DNS; не разрешилось или (без `allowPrivateNetwork`) хоть один частный — `WebToolError` `bad_address`. */
export async function checkedAddresses(hostname: string, resolveHost: HostResolver, allowPrivateNetwork: boolean): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) throw new WebToolError("bad_address", unresolvedMessage);
  if (!allowPrivateNetwork && addresses.some(isPrivateAddress)) throw new WebToolError("bad_address", notPublicMessage);
  return addresses;
}

/** Адрес из ответа DNS (без скобок). Всё, что не удалось разобрать, считается частным. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.trim().replace(/^\[|\]$/g, "");
  const ipv4 = parseIpv4(bare);
  if (ipv4) return isPrivateIpv4(ipv4);
  const groups = parseIpv6(bare);
  return groups ? isPrivateIpv6(groups) : true;
}

function isLocalHost(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("[")) return isPrivateAddress(hostname.slice(1, -1));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return isPrivateAddress(hostname);
  if (!hostname.includes(".")) return true;
  return hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal");
}

function parseIpv4(text: string): number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return undefined;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

/** Восемь групп по 16 бит или `undefined`. Понимает `::` и IPv4 в конце. */
function parseIpv6(text: string): number[] | undefined {
  const withoutZone = text.split("%")[0] ?? "";
  if (!/^[0-9a-f:.]+$/i.test(withoutZone) || !withoutZone.includes(":")) return undefined;
  let value = withoutZone;
  const tail = value.slice(value.lastIndexOf(":") + 1);
  if (tail.includes(".")) {
    const ipv4 = parseIpv4(tail);
    if (!ipv4) return undefined;
    const [a = 0, b = 0, c = 0, d = 0] = ipv4;
    value = `${value.slice(0, value.lastIndexOf(":") + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return undefined;
  const toGroups = (part: string): number[] | undefined => {
    if (part === "") return [];
    const texts = part.split(":");
    if (!texts.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;
    return texts.map((group) => parseInt(group, 16));
  };
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (!head || !rest) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - rest.length;
  return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...rest] : undefined;
}

function isPrivateIpv4([first = 0, second = 0, third = 0]: number[]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPrivateIpv6(groups: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const embedded = (high: number, low: number) => isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  const zeroUpTo = (count: number) => groups.slice(0, count).every((group) => group === 0);

  if (zeroUpTo(6)) return embedded(g6, g7); // ::/96, в том числе :: и ::1
  if (zeroUpTo(5) && g5 === 0xffff) return embedded(g6, g7); // ::ffff:0:0/96
  if (g0 === 0x64 && g1 === 0xff9b) {
    if (g2 === 1) return true; // 64:ff9b:1::/48, локальное использование
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7); // 64:ff9b::/96
  }
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4 несёт IPv4 в адресе
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // для документации
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 || (g0 & 0xff00) === 0xff00;
}
