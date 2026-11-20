import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Тексту в одной строке с кнопками нужно не меньше этой доли строки… */
const minTextShare = 0.55;
/** …и не меньше этой ширины: в неё помещается обычная подсказка поля. */
const minTextPx = 160;
/** На широкой строке столько тексту хватает всегда, даже если это меньше доли. */
const enoughTextPx = 320;
/**
 * Обратно в одну строку — только с таким запасом. Ширина кнопок меняется на ходу (диктовка, «Остановить» рядом с
 * «Отправить»); без запаса поле на пороге прыгало бы из одной строки в две и обратно.
 */
const settleMarginPx = 40;

/** `inner` — ширина строки внутри рамки, `controls` — кнопки с промежутками. Не измерено (0) — помещается. */
export function textFitsInRow(inner: number, controls: number): boolean {
  if (inner <= 0) return true;
  return inner - controls >= Math.max(Math.min(inner * minTextShare, enoughTextPx), minTextPx);
}

/** Следующее решение с учётом прежнего: в два ряда — сразу, как тексту тесно; обратно — только с запасом. */
export function nextCrowded(crowded: boolean, inner: number, controls: number): boolean {
  return !textFitsInRow(inner, crowded ? controls + settleMarginPx : controls);
}

/**
 * Поле с кнопками в одну строку, пока тексту хватает места; иначе `true` — кнопки уходят в ряд под текстом.
 * `measure` возвращает ширину строки и кнопок; ширина кнопок не зависит от раскладки, поэтому решение не скачет.
 * Наблюдатель за размерами — один на жизнь поля; кнопки, появившиеся позже, он берёт под наблюдение после отрисовки.
 */
export function useCrowdedRow(root: RefObject<HTMLElement | null>, measure: (root: HTMLElement) => { inner: number; controls: number } | null, enabled: boolean): boolean {
  const [crowded, setCrowded] = useState(false);
  const measureNow = useRef(measure);
  measureNow.current = measure;
  const refresh = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!enabled || !element) { setCrowded(false); return; }
    const update = () => {
      const size = measureNow.current(element);
      setCrowded((was) => size !== null && nextCrowded(was, size.inner, size.controls));
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const watched = new WeakSet<Element>();
    refresh.current = () => {
      if (observer) for (const target of [element, ...element.querySelectorAll("button, [data-row-controls]")]) {
        if (watched.has(target)) continue;
        watched.add(target);
        observer.observe(target);
      }
      update();
    };
    return () => { observer?.disconnect(); refresh.current = null; };
  }, [enabled, root]);
  // Каждая отрисовка может добавить или убрать кнопку: перемерить и взять новые под наблюдение.
  useLayoutEffect(() => refresh.current?.());
  return crowded;
}
