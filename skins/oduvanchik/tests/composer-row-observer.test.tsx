// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextCrowded, useCrowdedRow } from "../src/composer-row";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Row({ value, controls }: { value: string; controls: number }) {
  const root = useRef<HTMLDivElement>(null);
  const crowded = useCrowdedRow(root, () => ({ inner: 316, controls }), true);
  return <div ref={root} data-crowded={String(crowded)}><textarea value={value} readOnly /><button type="button">+</button></div>;
}

describe("поле в одну строку: наблюдение за шириной", () => {
  it("один наблюдатель на жизнь поля, а не новый на каждый символ", () => {
    const created = vi.fn();
    vi.stubGlobal("ResizeObserver", class { constructor() { created(); } observe() {} unobserve() {} disconnect() {} });
    const { rerender } = render(<Row value="" controls={92} />);
    for (const value of ["к", "ко", "кот", "кот в", "кот в шляпе"]) rerender(<Row value={value} controls={92} />);
    expect(created).toHaveBeenCalledTimes(1);
  });

  it("кнопки стали шире во время диктовки и снова уже — поле не прыгает туда-обратно на пороге", () => {
    // Строка 316 px: тексту нужно 55 % — 174 px. Кнопкам 142 — помещается; 143 — уже нет.
    expect(nextCrowded(false, 316, 142)).toBe(false);
    expect(nextCrowded(false, 316, 143)).toBe(true);
    // Уже в два ряда: обратно в одну строку — только с запасом, а не от пары пикселей.
    expect(nextCrowded(true, 316, 110)).toBe(true);
    expect(nextCrowded(true, 316, 100)).toBe(false);
  });
});
