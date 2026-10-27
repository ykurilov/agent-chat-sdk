import type { MediaViewerItem, MediaViewerProps } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ChevronLeft, ChevronRight, Maximize, X } from "./icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** Шаг масштаба с клавиатуры (+ и −). */
const KEY_ZOOM_STEP = 1.5;
/** Сколько пикселей пальцем вбок — уже свайп, а не дрожание. */
const SWIPE_PX = 50;
/** Движение дальше этого — перетаскивание: клик по фону после него окно не закрывает. */
const DRAG_PX = 6;

interface Zoom {
  /** Элемент, к которому относится масштаб: другая картинка открывается вписанной. */
  key: string;
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
const FOCUSABLE = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
const roundButton =
  "tandem-focus grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors duration-[var(--motion-fast)] hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-white/10";

/**
 * Масштаб вокруг точки `anchor` (от центра сцены): точка под курсором или между пальцами остаётся на месте.
 * Вписанная картинка всегда по центру.
 */
function zoomAround(zoom: Zoom, nextScale: number, anchor: Point): Zoom {
  const scale = clampScale(nextScale);
  if (scale === MIN_SCALE) return { ...zoom, scale, x: 0, y: 0 };
  const ratio = scale / zoom.scale;
  return { ...zoom, scale, x: anchor.x - (anchor.x - zoom.x) * ratio, y: anchor.y - (anchor.y - zoom.y) * ratio };
}

/**
 * Окно просмотра картинок и схем во весь экран (договор скина, версия 13). Листание — стрелками на экране, ← и →,
 * свайпом; масштаб — колесом, щипком, + и −; увеличенное перетаскивается; «вписать» и 0 возвращают как было.
 * Закрытие — крестик, Esc, клик по фону; запись в истории для жеста «назад» и возврат фокуса ведёт слой поведения.
 * Схема — векторный SVG как есть: при увеличении браузер перерисовывает её, а не растягивает картинку.
 */
export function OduvanchikMediaViewer({ items, index, onIndexChange, onClose }: MediaViewerProps) {
  const labels = useChatLabels();
  const item = items[index];
  const many = items.length > 1;
  const canPrevious = many && index > 0;
  const canNext = many && index < items.length - 1;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stored, setZoom] = useState<Zoom>({ key: item?.key ?? "", scale: 1, x: 0, y: 0 });
  const zoom = stored.key === item?.key ? stored : { key: item?.key ?? "", scale: 1, x: 0, y: 0 };
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; startZoom: Zoom; pinch?: { distance: number; zoom: Zoom }; moved: boolean } | null>(null);
  const draggedRecently = useRef(false);

  // Фокус внутри окна; страница под окном не прокручивается.
  useLayoutEffect(() => {
    closeRef.current?.focus();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // Колесо — своим слушателем: только не пассивный может отменить прокрутку и масштаб страницы (щипок тачпада).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Щипок тачпада приходит колесом с ctrlKey и мелкими шагами.
      const speed = event.ctrlKey ? 0.01 : 0.0015;
      const current = zoomRef.current;
      setZoom(zoomAround(current, current.scale * Math.exp(-event.deltaY * speed), fromCenter(stage, event.clientX, event.clientY)));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  if (!item) return null;

  const go = (next: number) => {
    if (next >= 0 && next < items.length && next !== index) onIndexChange(next);
  };
  const fit = () => setZoom({ key: item.key, scale: 1, x: 0, y: 0 });
  const zoomBy = (factor: number) => setZoom(zoomAround(zoom, zoom.scale * factor, { x: zoom.x, y: zoom.y }));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // Esc закрывает только окно: панель агента и другие окна под ним остаются.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === "+" || event.key === "=") {
      zoomBy(KEY_ZOOM_STEP);
    } else if (event.key === "-") {
      zoomBy(1 / KEY_ZOOM_STEP);
    } else if (event.key === "0") {
      fit();
    } else if (event.key === "Tab") {
      trapFocus(event, dialogRef.current);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // Кнопки на сцене (стрелки) жестов не начинают.
    if ((event.target as Element).closest("button")) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      gesture.current = {
        start: points[0]!,
        startZoom: zoom,
        pinch: { distance: distance(points[0]!, points[1]!), zoom },
        moved: true,
      };
    } else if (points.length === 1) {
      gesture.current = { start: { x: event.clientX, y: event.clientY }, startZoom: zoom, moved: false };
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    const current = gesture.current;
    if (current.pinch && points.length >= 2) {
      const [a, b] = points as [Point, Point];
      const middle = fromCenter(event.currentTarget, (a.x + b.x) / 2, (a.y + b.y) / 2);
      setZoom(zoomAround(current.pinch.zoom, current.pinch.zoom.scale * (distance(a, b) / current.pinch.distance), middle));
      return;
    }
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) > DRAG_PX) {
      current.moved = true;
      // Захват — только когда палец поехал: захват с нажатия перенёс бы клик по картинке на фон, и окно закрылось бы.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (current.startZoom.scale > MIN_SCALE) setZoom({ ...current.startZoom, x: current.startZoom.x + dx, y: current.startZoom.y + dy });
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    const current = gesture.current;
    if (!current) return;
    if (current.moved) draggedRecently.current = true;
    if (current.pinch) {
      // Один палец остался после щипка: дальше он перетаскивает, не листает.
      if (pointers.current.size === 1) {
        const [rest] = [...pointers.current.values()] as [Point];
        gesture.current = { start: rest, startZoom: zoomRef.current, moved: true };
      } else gesture.current = null;
      return;
    }
    gesture.current = null;
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    // Свайп — только у вписанной картинки: увеличенную палец двигает.
    if (current.startZoom.scale === MIN_SCALE && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? index + 1 : index - 1);
  }

  function onStageClick(event: MouseEvent<HTMLDivElement>) {
    const dragged = draggedRecently.current;
    draggedRecently.current = false;
    // Клик по затемнённому фону закрывает; по картинке и после перетаскивания — нет.
    if (!dragged && event.target === event.currentTarget) onClose();
  }

  const name = item.kind === "image" ? item.alt : labels.voice.diagramOnScreen;
  return (
    <div
      ref={dialogRef}
      data-agent-chat-oduvanchik=""
      role="dialog"
      aria-modal="true"
      aria-label={name}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[60] flex outline-none flex-col bg-[color-mix(in_srgb,black_88%,transparent)] text-white"
    >
      <div className="flex items-center gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <p aria-live="polite" className="min-w-0 flex-1 truncate pl-2 text-sm font-semibold tabular-nums">
          {many && labels.viewer.counter(index + 1, items.length)}
        </p>
        <button type="button" aria-label={labels.viewer.fit} title={labels.viewer.fit} onClick={fit} className={roundButton}>
          <Maximize className="size-5" aria-hidden="true" />
        </button>
        <button ref={closeRef} type="button" aria-label={labels.viewer.close} title={labels.viewer.close} onClick={onClose} className={roundButton}>
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div
        ref={stageRef}
        data-viewer-stage=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onStageClick}
        className="relative grid min-h-0 flex-1 touch-none select-none place-items-center overflow-hidden px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <div
          data-viewer-content=""
          data-scale={zoom.scale}
          style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
          className={zoom.scale > MIN_SCALE ? "cursor-grab active:cursor-grabbing" : undefined}
        >
          <ViewerItem item={item} />
        </div>
        {many && (
          <>
            <button
              type="button"
              aria-label={labels.viewer.previous}
              title={labels.viewer.previous}
              disabled={!canPrevious}
              onClick={() => go(index - 1)}
              className={`${roundButton} absolute left-2 top-1/2 -translate-y-1/2`}
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={labels.viewer.next}
              title={labels.viewer.next}
              disabled={!canNext}
              onClick={() => go(index + 1)}
              className={`${roundButton} absolute right-2 top-1/2 -translate-y-1/2`}
            >
              <ChevronRight className="size-6" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ViewerItem({ item }: { item: MediaViewerItem }): ReactNode {
  if (item.kind === "image") {
    return (
      <img
        src={item.src}
        alt={item.alt}
        draggable={false}
        {...(item.width && { width: item.width })}
        {...(item.height && { height: item.height })}
        className="block h-auto max-h-[calc(100dvh-5.5rem)] w-auto max-w-[calc(100vw-1rem)] object-contain"
      />
    );
  }
  // Схема уже очищена пакетом схем (договор diagrams): кладётся разметкой, чтобы остаться векторной.
  return (
    <div className="w-[calc(100vw-1rem)] max-w-5xl rounded-[var(--radius-panel)] bg-[var(--surface)] p-4 text-[var(--foreground)]">
      <div
        aria-hidden="true"
        className="[&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-[calc(100dvh-8rem)] [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: item.svg }}
      />
      <p className="sr-only">{item.source}</p>
    </div>
  );
}

/** Точка экрана относительно центра сцены: от него считаются сдвиг и масштаб. */
function fromCenter(stage: HTMLElement, clientX: number, clientY: number): Point {
  const box = stage.getBoundingClientRect();
  return { x: clientX - (box.left + box.width / 2), y: clientY - (box.top + box.height / 2) };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Tab не уходит из окна: с последнего — на первый, Shift+Tab с первого — на последний. */
function trapFocus(event: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
