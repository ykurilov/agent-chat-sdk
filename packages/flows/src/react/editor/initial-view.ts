// Каким доска открывается: масштаб и место. Чистый расчёт, без доски — его проверяют тесты.

/**
 * Начальный масштаб доски.
 * - `"readable"` (по умолчанию) — вся схема, если она помещается не мельче {@link READABLE_ZOOM}; иначе масштаб
 *   {@link READABLE_ZOOM} и на виду начало схемы (стартовое состояние у левого края).
 * - `"fit"` — вся схема целиком, как бы мелко ни вышло (как «Весь граф»).
 * - число — этот масштаб (`1` — натуральный, `0.8` — 80 %); схема помещается — она по центру, нет — на виду начало.
 */
export type FlowInitialZoom = "readable" | "fit" | number;

/** Мельче этого подписи в узлах уже трудно читать. */
export const READABLE_ZOOM = 0.75;
export const MIN_BOARD_ZOOM = 0.1;
export const MAX_BOARD_ZOOM = 2;
/** Отступ от краёв доски: доля её ширины и высоты. */
const PADDING = 0.1;
/** «Весь граф» не крупнее натурального. */
const MAX_FIT_ZOOM = 1;

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Самый крупный масштаб, в котором вся схема помещается с отступами. */
function roomZoom(bounds: ViewRect, width: number, height: number): number {
  const xZoom = (width * (1 - 2 * PADDING)) / Math.max(bounds.width, 1);
  const yZoom = (height * (1 - 2 * PADDING)) / Math.max(bounds.height, 1);
  return Math.min(xZoom, yZoom);
}

function centered(bounds: ViewRect, width: number, height: number, zoom: number): Viewport {
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}

/** Схема не помещается: начало у левого края, по высоте — стартовое состояние посередине, но не выше верха схемы. */
function atStart(bounds: ViewRect, start: ViewRect | null, width: number, height: number, zoom: number): Viewport {
  const anchor = start ?? bounds;
  const left = width * PADDING * 0.5;
  const top = height * PADDING * 0.5;
  const x = left - anchor.x * zoom;
  const middle = height / 2 - (anchor.y + anchor.height / 2) * zoom;
  // Схема ниже по высоте, чем доска, — ставим по центру; выше — стартовое посередине, но край схемы не уходит ниже верха.
  const y = bounds.height * zoom <= height - 2 * top ? height / 2 - (bounds.y + bounds.height / 2) * zoom : Math.min(middle, top - bounds.y * zoom);
  return { x, y, zoom };
}

/**
 * Где и в каком масштабе открыть доску. `bounds` — рамка всех узлов, `start` — стартового состояния (если есть),
 * `width` и `height` — размер доски в пикселях.
 */
export function initialViewport(options: {
  bounds: ViewRect;
  start: ViewRect | null;
  width: number;
  height: number;
  initialZoom?: FlowInitialZoom;
}): Viewport {
  const { bounds, start, width, height, initialZoom = "readable" } = options;
  const room = roomZoom(bounds, width, height);
  const whole = clamp(room, MIN_BOARD_ZOOM, MAX_FIT_ZOOM);
  if (initialZoom === "fit") return centered(bounds, width, height, whole);
  if (initialZoom === "readable") {
    return whole >= READABLE_ZOOM ? centered(bounds, width, height, whole) : atStart(bounds, start, width, height, READABLE_ZOOM);
  }
  const wanted = clamp(Number.isFinite(initialZoom) ? initialZoom : 1, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
  return room >= wanted ? centered(bounds, width, height, wanted) : atStart(bounds, start, width, height, wanted);
}
