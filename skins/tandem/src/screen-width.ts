import { useSyncExternalStore } from "react";

/** Подходит ли экран под медиазапрос; где `matchMedia` нет (проверки в jsdom, серверная отрисовка) — `fallback`. */
export function useScreenQuery(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}
