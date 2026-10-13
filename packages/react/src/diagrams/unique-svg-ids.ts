const ID_ATTRIBUTE = /\sid="([^"]+)"/g;
/** `id="…"` или ссылка `#…` (в `url(#…)`, `href="#…"` и селекторах стилей). */
const ID_OR_REFERENCE = /(\sid=")([^"]+)(")|#([\p{L}\p{N}_-]+)/gu;

/**
 * Разметка схемы со своими id для одной вставки в страницу. Один готовый рисунок из кэша может стоять в ленте
 * дважды и ещё в окне просмотра; при одинаковых id `url(#…)` берёт первый в странице, и стрелки пропадают вместе
 * с ним. Каждый id рисунка получает суффикс вставки, ссылки на него в атрибутах и стилях — тоже.
 */
export function withUniqueIds(svg: string, suffix: string): string {
  const ids = new Set([...svg.matchAll(ID_ATTRIBUTE)].map((match) => match[1]!));
  if (ids.size === 0) return svg;
  const tail = `-${suffix.replace(/[^\w-]/g, "")}`;
  return svg.replace(ID_OR_REFERENCE, (whole, open?: string, id?: string, close?: string, reference?: string) => {
    if (open !== undefined) return `${open}${id}${tail}${close}`;
    return ids.has(reference!) ? `#${reference}${tail}` : whole;
  });
}
