import { useMemo, useSyncExternalStore } from "react";
import type { ChatSkin, DiagramColors } from "../skin-contract";

/** Цвета, если скин своих не дал: спокойные серые, читаются на любом фоне. */
const FALLBACK_COLORS: Record<"light" | "dark", DiagramColors> = {
  light: { background: "#ffffff", text: "#1f2328", line: "#6e7781", node: "#f3f4f6", accent: "#0969da", dark: false },
  dark: { background: "#16181b", text: "#e6e8eb", line: "#8b949e", node: "#24282d", accent: "#58a6ff", dark: true },
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Тёмная ли сейчас страница: класс `dark` у корня (так включают тему Тандем и Tailwind), иначе `color-scheme` корня,
 * а если он не задан или разрешает обе — тема системы.
 */
function pageIsDark(): boolean {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return true;
  const scheme = getComputedStyle(root).colorScheme?.trim() ?? "";
  if (/\bdark\b/.test(scheme) && !/\blight\b/.test(scheme)) return true;
  if (/\blight\b/.test(scheme) && !/\bdark\b/.test(scheme)) return false;
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  const media = typeof matchMedia === "function" ? matchMedia(DARK_QUERY) : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

const neverSubscribe = () => () => undefined;

/** Тёмная ли страница, со слежением за сменой темы; `enabled: false` — не следит и отдаёт `false`. */
export function usePageDark(enabled: boolean): boolean {
  return useSyncExternalStore(enabled ? subscribe : neverSubscribe, () => enabled && pageIsDark(), () => false);
}

/**
 * Цвета схем для текущей темы страницы (FR-028): `skin.diagramColors(dark)`, без него — свои. Смена темы даёт новые
 * цвета, и схемы перерисовываются. `enabled: false` (схемы не подключены) — за темой не следит и отдаёт `undefined`.
 */
export function useDiagramColors(skin: ChatSkin, enabled: boolean): DiagramColors | undefined {
  const dark = usePageDark(enabled);
  return useMemo(() => {
    if (!enabled) return undefined;
    return skin.diagramColors?.(dark) ?? FALLBACK_COLORS[dark ? "dark" : "light"];
  }, [dark, enabled, skin]);
}
