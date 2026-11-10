import { describe, expect, it } from "vitest";
import { initialViewport, READABLE_ZOOM } from "../../src/react/editor/initial-view";

const board = { width: 1000, height: 600 };
const small = { x: 0, y: 0, width: 600, height: 300 };
const big = { x: 0, y: 0, width: 2600, height: 900 };
const start = { x: 40, y: 300, width: 264, height: 180 };

describe("initialViewport", () => {
  it("по умолчанию большая схема открывается читаемой, а не крошечной", () => {
    const view = initialViewport({ bounds: big, start, ...board });
    expect(view.zoom).toBe(READABLE_ZOOM);
    // Стартовое состояние на виду у левого края.
    const left = view.x + start.x * view.zoom;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(board.width / 4);
    const top = view.y + start.y * view.zoom;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + start.height * view.zoom).toBeLessThanOrEqual(board.height);
  });

  it("по умолчанию небольшая схема видна целиком и не крупнее натурального", () => {
    const view = initialViewport({ bounds: small, start, ...board });
    expect(view.zoom).toBe(1);
    expect(view.x).toBe(200);
    expect(view.y).toBe(150);
  });

  it("«fit» вписывает всю схему, как бы мелко ни вышло", () => {
    const view = initialViewport({ bounds: big, start, ...board, initialZoom: "fit" });
    expect(view.zoom).toBeCloseTo(800 / 2600);
    expect(view.x + big.width * view.zoom).toBeLessThanOrEqual(board.width);
  });

  it("число задаёт масштаб: схема помещается — по центру, нет — на виду начало", () => {
    const fits = initialViewport({ bounds: small, start, ...board, initialZoom: 1.2 });
    expect(fits.zoom).toBe(1.2);
    expect(fits.x).toBeCloseTo(500 - 300 * 1.2);
    const large = initialViewport({ bounds: big, start, ...board, initialZoom: 1 });
    expect(large.zoom).toBe(1);
    expect(large.x + start.x).toBeLessThan(board.width / 4);
  });

  it("масштаб вне допустимого прижимается к краям", () => {
    expect(initialViewport({ bounds: small, start, ...board, initialZoom: 9 }).zoom).toBe(2);
    expect(initialViewport({ bounds: small, start, ...board, initialZoom: 0 }).zoom).toBe(0.1);
  });

  it("без стартового состояния на виду левый край схемы", () => {
    const view = initialViewport({ bounds: { ...big, x: -100 }, start: null, ...board });
    expect(view.x - 100 * view.zoom).toBeGreaterThanOrEqual(0);
  });
});
