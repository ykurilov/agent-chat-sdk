import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlowEditorMode } from "../flow-editor-skin";
import type { FlowSelection } from "./use-flow-editor";

// Место на экране: что на доске свёрнуто, открыта ли правая панель, развёрнут ли весь редактор. Состояние «свёрнуто»
// запоминается в localStorage браузера (общее для всех сценариев приложения), на сервере и без localStorage — по умолчанию.

/** Шапка доски: `full` — логотип, название и кнопки; `compact` — одна узкая строка кнопок (название у приложения своё). */
export type FlowHeaderMode = "full" | "compact";
/** Легенда «Условия выхода»: свёрнута в кнопку, открыта или убрана совсем. */
export type FlowLegendMode = "collapsed" | "open" | "hidden";
/** Мини-карта: открыта, свёрнута в кнопку или убрана совсем. */
export type FlowMinimapMode = "open" | "collapsed" | "hidden";
/** Панель «Сценарий»: `open` — открыта, сворачивается кнопкой; `collapsible` — свёрнута, пока ничего не выбрано, выбор раскрывает. */
export type FlowInspectorMode = "open" | "collapsible";

export interface FlowBoardSpaceProps {
  header?: FlowHeaderMode;
  legend?: FlowLegendMode;
  minimap?: FlowMinimapMode;
  inspector?: FlowInspectorMode;
  /** Кнопка «На весь экран» в шапке. По умолчанию есть. */
  fullscreen?: boolean;
  /** Ключ в localStorage для запомненного. По умолчанию общий `agent-chat-flow-board`; `null` — не запоминать. */
  storageKey?: string | null;
}

export const DEFAULT_SPACE_STORAGE_KEY = "agent-chat-flow-board";

interface Remembered {
  legend?: boolean;
  minimap?: boolean;
  inspector?: boolean;
}

function readRemembered(key: string | null | undefined): Remembered {
  if (!key || typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Remembered = {};
    for (const name of ["legend", "minimap", "inspector"] as const) {
      const value = (parsed as Record<string, unknown>)[name];
      if (typeof value === "boolean") result[name] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writeRemembered(key: string | null | undefined, value: Remembered) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Хранилище закрыто или переполнено — просто не запоминаем.
  }
}

const selectionKey = (selection: FlowSelection) => {
  if (selection.kind === "state") return `state:${selection.stateId}:${selection.exitId ?? ""}`;
  if (selection.kind === "any") return `any:${selection.exitId ?? ""}`;
  return selection.kind === "overview" ? `overview:${selection.sideTaskId ?? ""}` : selection.kind;
};

export interface BoardSpace {
  header: FlowHeaderMode;
  legendHidden: boolean;
  legendOpen: boolean;
  toggleLegend(): void;
  minimapHidden: boolean;
  minimapOpen: boolean;
  toggleMinimap(): void;
  inspectorOpen: boolean;
  /** Кнопка сворачивания панели нужна только в обычной правке: проверка и прогон держат панель открытой. */
  inspectorToggleable: boolean;
  toggleInspector(): void;
  fullscreenAllowed: boolean;
  fullscreen: boolean;
  setFullscreen(on: boolean): void;
}

export function useBoardSpace(
  props: FlowBoardSpaceProps,
  editor: { selection: FlowSelection; mode: FlowEditorMode },
): BoardSpace {
  const { header = "full", legend = "collapsed", minimap = "open", inspector = "open", fullscreen: fullscreenAllowed = true } = props;
  const storageKey = props.storageKey === undefined ? DEFAULT_SPACE_STORAGE_KEY : props.storageKey;

  const [remembered, setRemembered] = useState<Remembered>({});
  // Читаем после первого показа: на сервере и при гидратации экран тот же, что по умолчанию.
  useEffect(() => setRemembered(readRemembered(storageKey)), [storageKey]);
  // Пишем в хранилище из эффекта, а не из функции setState (она может вызываться дважды).
  const unsaved = useRef(false);
  useEffect(() => {
    if (!unsaved.current) return;
    unsaved.current = false;
    writeRemembered(storageKey, remembered);
  }, [remembered, storageKey]);
  const remember = useCallback((name: keyof Remembered, value: boolean) => {
    unsaved.current = true;
    setRemembered((current) => ({ ...current, [name]: value }));
  }, []);

  const legendOpen = legend === "hidden" ? false : (remembered.legend ?? legend === "open");
  const minimapOpen = minimap === "hidden" ? false : (remembered.minimap ?? minimap === "open");

  // «collapsible»: панель следует за выбором и не запоминается, «open»: запоминается выбор человека.
  const selected = editor.selection.kind !== "overview" || editor.selection.sideTaskId !== undefined;
  const key = selectionKey(editor.selection);
  const [followed, setFollowed] = useState(selected);
  const [previousKey, setPreviousKey] = useState(key);
  if (key !== previousKey) {
    setPreviousKey(key);
    setFollowed(selected);
  }
  // Проверка и прогон живут в панели: в них она открыта всегда.
  const needed = editor.mode !== "edit";
  const inspectorOpen = needed || (inspector === "collapsible" ? followed : (remembered.inspector ?? true));

  const [fullscreen, setFullscreen] = useState(false);
  // Приложение выключило полный экран на лету — внутреннее состояние не должно вернуться при включении.
  useEffect(() => {
    if (!fullscreenAllowed) setFullscreen(false);
  }, [fullscreenAllowed]);

  return useMemo(
    () => ({
      header,
      legendHidden: legend === "hidden",
      legendOpen,
      toggleLegend: () => remember("legend", !legendOpen),
      minimapHidden: minimap === "hidden",
      minimapOpen,
      toggleMinimap: () => remember("minimap", !minimapOpen),
      inspectorOpen,
      inspectorToggleable: !needed,
      toggleInspector: () => {
        if (needed) return;
        if (inspector === "collapsible") setFollowed(!inspectorOpen);
        else remember("inspector", !inspectorOpen);
      },
      fullscreenAllowed,
      fullscreen: fullscreenAllowed && fullscreen,
      setFullscreen,
    }),
    [header, legend, legendOpen, minimap, minimapOpen, inspector, inspectorOpen, needed, fullscreenAllowed, fullscreen, remember],
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Полный экран: Esc выходит (если не открыто окно поверх), страница под редактором не прокручивается, Tab ходит по кругу
 * внутри. Возвращает ссылку-обработчик клавиш для корня.
 */
export function useFullscreenBehavior(active: boolean, onExit: () => void, blocked: boolean, root: HTMLElement | null) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || blocked) return;
      // Esc в поле ввода только снимает фокус; выход — Esc вне поля.
      const target = event.target;
      if (target instanceof HTMLElement && root?.contains(target) && target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
        event.preventDefault();
        target.blur();
        return;
      }
      event.preventDefault();
      onExit();
      // Кнопка в шапке остаётся на месте: фокус возвращается на неё.
      root?.querySelector<HTMLElement>("[data-flow-fullscreen-toggle]")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, blocked, onExit, root]);

  return useCallback(
    (event: { key: string; shiftKey: boolean; target: EventTarget; preventDefault(): void }) => {
      // События React всплывают и через портал (окно JSON в body): чужой Tab не трогаем.
      if (!active || event.key !== "Tab" || !root || !(event.target instanceof Node) || !root.contains(event.target)) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !root.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !root.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    },
    [active, root],
  );
}
