import type { FlowCatalog } from "./flow-format";

/** Имена кнопок и событий приложения — каталог даёт их строками или объектами `{ name, label }`. */
export function catalogEventNames(catalog: Pick<FlowCatalog, "events">): string[] {
  return catalog.events.map((event) => (typeof event === "string" ? event : event.name));
}

/** Подпись события из каталога; нет каталога, события или подписи — `undefined`, и показывают имя. */
export function catalogEventLabel(catalog: Pick<FlowCatalog, "events"> | undefined, name: string): string | undefined {
  const found = catalog?.events.find((event) => typeof event !== "string" && event.name === name);
  return typeof found === "object" ? found.label?.trim() || undefined : undefined;
}
