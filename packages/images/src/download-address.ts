/*
 * Куда можно идти за готовой картинкой. Адрес приходит в ответе провайдера; без проверки подменённый ответ (прокси,
 * взломанный склад) отправил бы сервер во внутреннюю сеть: к метаданным облака, базе, админке. Поэтому — только
 * `https:` и не внутренние адреса. Исключение — сайт подключения провайдера из настройки приложения: ему доверяют
 * и так (свой прокси, поддельный провайдер демо на localhost). Имена хостов в адреса здесь не разрешаются.
 */

/** Внутренние диапазоны IPv4: [первый октет, второй от, второй до] или [первый октет]. */
const PRIVATE_IPV4: Array<[number, number?, number?]> = [
  [0], [10], [127], [100, 64, 127], [169, 254, 254], [172, 16, 31], [192, 168, 168], [198, 18, 19],
];

function isPrivateIpv4(octets: number[]): boolean {
  const [first = 0, second = 0, third = 0] = octets;
  if (first >= 224) return true; // групповые, зарезервированные, широковещательный
  if (first === 192 && second === 0 && third === 0) return true;
  return PRIVATE_IPV4.some(([a, from, to]) => first === a && (from === undefined || (second >= from && second <= (to ?? from))));
}

/** Восемь групп IPv6 из записи, которую уже привёл к виду разборщик URL (без скобок). */
function ipv6Groups(host: string): number[] | null {
  const [head = "", tail, extra] = host.split("::");
  if (extra !== undefined) return null;
  const part = (text: string) => (text === "" ? [] : text.split(":").map((group) => Number.parseInt(group, 16)));
  const left = part(head);
  const right = tail === undefined ? [] : part(tail);
  const groups = tail === undefined ? left : [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function isPrivateIpv6(host: string): boolean {
  const groups = ipv6Groups(host);
  if (!groups) return true;
  const [first = 0] = groups;
  if (groups.slice(0, 7).every((group) => group === 0) && (groups[7] ?? 0) <= 1) return true; // :: и ::1
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
  // IPv4 внутри IPv6: ::ffff:a.b.c.d и ::a.b.c.d.
  if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    const [high = 0, low = 0] = groups.slice(6);
    return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return false;
}

function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) return isPrivateIpv6(host.slice(1, -1));
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) return isPrivateIpv4(ipv4.slice(1).map(Number));
  return !host.includes(".") || /\.(?:localhost|local|internal|home\.arpa)$/.test(host);
}

/** Можно ли скачать картинку по этому адресу. `trustedOrigin` — сайт подключения провайдера из настройки. */
export function isAllowedImageAddress(address: URL, trustedOrigin?: string): boolean {
  if (trustedOrigin !== undefined && address.origin === trustedOrigin) return true;
  return address.protocol === "https:" && !isInternalHost(address.hostname);
}
