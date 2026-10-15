// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GeneratedImagesView } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemSkin } from "../src/index";
import { TandemGeneratedImages } from "../src/generated-images";

afterEach(cleanup);

const ready = (n: number, onOpen = vi.fn()) => ({
  state: "ready" as const,
  key: `img-${n}`,
  src: `/api/chat/c1/attachments/img-${n}`,
  alt: "Маяк на рассвете",
  width: 1088,
  height: 608,
  onOpen,
});
const loading = (n: number) => ({ state: "loading" as const, key: `g1:${n}` });
const view = (items: GeneratedImagesView["items"], fields: Partial<GeneratedImagesView> = {}): GeneratedImagesView => ({
  ordered: items.length,
  aspectRatio: "16:9",
  items,
  stopped: false,
  ...fields,
});

const tiles = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-tile]")];
/** Классы, от которых зависит место плитки в ленте: ширина, высота, пропорция, рамка. */
const sizing = (tile: HTMLElement) => tile.className.split(/\s+/).filter((name) => /^(aspect-|w-|h-|size-|border$|p-)/.test(name)).sort().join(" ");

describe("картинки агента в Тандеме (T047)", () => {
  it("скин подключает GeneratedImages", () => {
    expect(tandemSkin.GeneratedImages).toBe(TandemGeneratedImages);
  });

  it("заглушки — той же пропорции и того же размера, что готовые: лента не прыгает при замене", () => {
    const { container, rerender } = render(<TandemGeneratedImages {...view([loading(1), loading(2), loading(3)])} />);
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.getAllByRole("status")[0]!.textContent).toContain("Картинка создаётся");
    const before = tiles(container).map(sizing);
    expect(before.every((name) => name.includes("aspect-[16/9]") && name.includes("w-full"))).toBe(true);

    rerender(<TandemGeneratedImages {...view([ready(1), ready(2), ready(3)])} />);
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(tiles(container).map(sizing)).toEqual(before);
  });

  it("готовая картинка — кнопка «Открыть картинку: alt» с лупой; клик и Enter открывают окно с кнопкой как источником", () => {
    const onOpen = vi.fn();
    render(<TandemGeneratedImages {...view([ready(1, onOpen)])} />);
    const button = screen.getByRole("button", { name: "Открыть картинку: Маяк на рассвете" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("cursor-zoom-in");
    const image = button.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/api/chat/c1/attachments/img-1");
    expect(image.getAttribute("width")).toBe("1088");
    expect(image.getAttribute("height")).toBe("608");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(button);
  });

  it("упавшая картинка подписана словами и причиной, не только цветом", () => {
    const { container } = render(<TandemGeneratedImages {...view([ready(1), { state: "failed", key: "g1:2", reason: "contentModeration: Blocked" }])} />);
    const failed = container.querySelector<HTMLElement>('[data-tile="failed"]')!;
    expect(failed.textContent).toContain("Картинка не создалась");
    expect(failed.textContent).toContain("contentModeration: Blocked");
    expect(failed.className).toContain("aspect-[16/9]");
  });

  it("«Стоп» — надпись «Создание остановлено»; без него надписи нет", () => {
    const { rerender } = render(<TandemGeneratedImages {...view([ready(1)], { ordered: 3, stopped: true })} />);
    expect(screen.getByText("Создание остановлено")).toBeTruthy();
    rerender(<TandemGeneratedImages {...view([ready(1)])} />);
    expect(screen.queryByText("Создание остановлено")).toBeNull();
  });

  it.each([
    ["1:1", "aspect-square"],
    ["3:2", "aspect-[3/2]"],
    ["2:3", "aspect-[2/3]"],
    ["9:16", "aspect-[9/16]"],
    ["5:4", "aspect-square"],
  ])("пропорция %s → %s", (aspectRatio, name) => {
    const { container } = render(<TandemGeneratedImages {...view([loading(1)], { aspectRatio })} />);
    expect(tiles(container)[0]!.className).toContain(name);
  });

  it("сетка: одна картинка — одна колонка, несколько — две, восемь — до четырёх на широком экране", () => {
    const grid = (count: number) => {
      const { container, unmount } = render(<TandemGeneratedImages {...view(Array.from({ length: count }, (_, i) => loading(i + 1)))} />);
      const name = container.querySelector("ul")!.className;
      unmount();
      return name;
    };
    expect(grid(1)).toContain("grid-cols-1");
    expect(grid(3)).toContain("grid-cols-2");
    expect(grid(8)).toContain("grid-cols-2");
    expect(grid(8)).toContain("sm:grid-cols-4");
  });
});

describe("картинка из библиотеки в Тандеме: по ширине ответа, своя пропорция, подпись (договор 26)", () => {
  const libraryItem = (onOpen = vi.fn()) => ({
    state: "ready" as const,
    key: "call-1",
    src: "/library/cell.png",
    alt: "Схема клетки: ядро и мембрана",
    caption: "Строение клетки",
    width: 1200,
    height: 800,
    onOpen,
  });

  it("во всю ширину ответа, пропорция из размеров картинки, без обрезки", () => {
    const { container } = render(<TandemGeneratedImages {...view([libraryItem()], { aspectRatio: "1200:800", wide: true })} />);
    const tile = tiles(container)[0]!;
    expect(tile.className).toContain("w-full");
    expect(tile.className).not.toMatch(/aspect-square/);
    expect(tile.style.aspectRatio).toBe("1200 / 800");
    expect(container.querySelector("ul")!.className).not.toMatch(/max-w-md/);
    expect(tile.querySelector("img")!.className).toContain("object-contain");
  });

  it("видимая подпись под картинкой; кнопка открывает окно просмотра", () => {
    const onOpen = vi.fn();
    render(<TandemGeneratedImages {...view([libraryItem(onOpen)], { wide: true })} />);
    const figure = screen.getByRole("figure");
    expect(figure.querySelector("figcaption")!.textContent).toBe("Строение клетки");
    const button = screen.getByRole("button", { name: "Открыть картинку: Схема клетки: ядро и мембрана" });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(button);
  });

  it("пустой вид (вызов идёт) — ничего не рисует, без надписи «создаётся»", () => {
    const { container } = render(<TandemGeneratedImages {...view([], { ordered: 1, wide: true })} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("подпись есть и у сетки: элемент с caption подписан под плиткой", () => {
    render(<TandemGeneratedImages {...view([{ ...ready(1), caption: "Маяк" }])} />);
    expect(screen.getByText("Маяк").tagName).toBe("FIGCAPTION");
  });
});
