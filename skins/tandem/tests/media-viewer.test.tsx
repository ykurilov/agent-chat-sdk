// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MediaViewerItem, MediaViewerProps } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemMediaViewer } from "../src/media-viewer";

afterEach(cleanup);

const pictures: MediaViewerItem[] = Array.from({ length: 12 }, (_, n) => ({
  kind: "image",
  key: `p${n + 1}`,
  src: `/p${n + 1}.png`,
  alt: `картинка ${n + 1}`,
}));
const diagram: MediaViewerItem = {
  kind: "diagram",
  key: "m1:0",
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>',
  source: "graph TD; A-->B",
};

function renderViewer(props: Partial<MediaViewerProps> = {}) {
  const onIndexChange = vi.fn();
  const onClose = vi.fn();
  const utils = render(<TandemMediaViewer items={pictures} index={2} onIndexChange={onIndexChange} onClose={onClose} {...props} />);
  return { ...utils, onIndexChange, onClose, dialog: screen.getByRole("dialog") };
}

const stage = () => document.querySelector<HTMLElement>("[data-viewer-stage]")!;
const content = () => document.querySelector<HTMLElement>("[data-viewer-content]")!;
const scaleOf = () => Number(content().getAttribute("data-scale"));
const translateOf = () => content().style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)!.slice(1).map(Number);
const pointer = (type: "pointerDown" | "pointerMove" | "pointerUp", id: number, x: number, y = 300) =>
  fireEvent[type](stage(), { pointerId: id, clientX: x, clientY: y, isPrimary: id === 1, pointerType: "touch", button: 0 });

describe("окно просмотра Тандема", () => {
  it("модальное окно: role=dialog, aria-modal, фокус внутри — на крестике", () => {
    const { dialog } = renderViewer();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Закрыть" }));
  });

  it("картинка вписана и подписана для диктора; счётчик «3 из 12», стрелки на экране", () => {
    renderViewer();
    const picture = screen.getByAltText("картинка 3");
    expect(picture.getAttribute("src")).toBe("/p3.png");
    expect(screen.getByText("3 из 12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Предыдущая" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Следующая" })).toBeTruthy();
  });

  it("одна картинка — без счётчика и стрелок", () => {
    renderViewer({ items: [pictures[0]!], index: 0 });
    expect(screen.queryByText("1 из 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Следующая" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Предыдущая" })).toBeNull();
  });

  it("листание: кнопки-стрелки и ←/→; на краях дальше не листает", () => {
    const { onIndexChange, dialog, rerender } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "Следующая" }));
    expect(onIndexChange).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Предыдущая" }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(onIndexChange).toHaveBeenLastCalledWith(1);

    onIndexChange.mockClear();
    rerender(<TandemMediaViewer items={pictures} index={0} onIndexChange={onIndexChange} onClose={vi.fn()} />);
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect((screen.getByRole("button", { name: "Предыдущая" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<TandemMediaViewer items={pictures} index={11} onIndexChange={onIndexChange} onClose={vi.fn()} />);
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("свайп пальцем влево — следующая, вправо — предыдущая; короткое движение — ничего", () => {
    const { onIndexChange } = renderViewer();
    pointer("pointerDown", 1, 300);
    pointer("pointerMove", 1, 150);
    pointer("pointerUp", 1, 150);
    expect(onIndexChange).toHaveBeenLastCalledWith(3);
    pointer("pointerDown", 1, 100);
    pointer("pointerMove", 1, 260);
    pointer("pointerUp", 1, 260);
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    onIndexChange.mockClear();
    pointer("pointerDown", 1, 100);
    pointer("pointerUp", 1, 110);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("закрытие: крестик, Esc (дальше не всплывает — панель агента не закрывается), клик по фону; клик по картинке не закрывает", () => {
    const outerKeyDown = vi.fn();
    const onClose = vi.fn();
    render(
      <div onKeyDown={(event) => outerKeyDown(event.defaultPrevented)}>
        <TandemMediaViewer items={pictures} index={2} onIndexChange={vi.fn()} onClose={onClose} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(outerKeyDown).not.toHaveBeenCalled();
    fireEvent.click(screen.getByAltText("картинка 3"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(stage());
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("диалог сам может держать фокус: клик по сцене не уводит клавиатуру на страницу под окном", () => {
    const { dialog } = renderViewer();
    expect(dialog.tabIndex).toBe(-1);
  });

  it("ловушка фокуса: Tab с последней кнопки — на первую, Shift+Tab с первой — на последнюю", () => {
    const { dialog } = renderViewer();
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    const first = buttons[0]!;
    const last = buttons.at(-1)!;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("масштаб колесом, «вписать» возвращает как было", () => {
    renderViewer();
    expect(scaleOf()).toBe(1);
    fireEvent.wheel(stage(), { deltaY: -300, clientX: 0, clientY: 0 });
    expect(scaleOf()).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "Вписать в экран" }));
    expect(scaleOf()).toBe(1);
    expect(content().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("щипок двумя пальцами увеличивает; перетаскивание увеличенной двигает её, а не листает", () => {
    const { onIndexChange } = renderViewer();
    pointer("pointerDown", 1, 200);
    pointer("pointerDown", 2, 300);
    pointer("pointerMove", 2, 400);
    pointer("pointerUp", 2, 400);
    pointer("pointerUp", 1, 200);
    expect(scaleOf()).toBeCloseTo(2, 1);

    const [x, y] = translateOf();
    pointer("pointerDown", 1, 300, 300);
    pointer("pointerMove", 1, 100, 250);
    pointer("pointerUp", 1, 100, 250);
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(translateOf()).toEqual([x! - 200, y! - 50]);
    expect(scaleOf()).toBeCloseTo(2, 1);
  });

  it("клавиатура: + увеличивает, 0 вписывает", () => {
    const { dialog } = renderViewer();
    fireEvent.keyDown(dialog, { key: "+" });
    expect(scaleOf()).toBeGreaterThan(1);
    fireEvent.keyDown(dialog, { key: "0" });
    expect(scaleOf()).toBe(1);
  });

  it("другая картинка открывается вписанной", () => {
    const { rerender } = renderViewer();
    fireEvent.wheel(stage(), { deltaY: -300 });
    rerender(<TandemMediaViewer items={pictures} index={3} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    expect(scaleOf()).toBe(1);
  });

  it("схема — SVG разметкой, без перевода в картинку; одна — без счётчика и стрелок; исходник для диктора", () => {
    renderViewer({ items: [diagram], index: 0 });
    expect(content().querySelector("svg")).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Следующая" })).toBeNull();
    expect(screen.getByText("graph TD; A-->B")).toBeTruthy();
  });

  it("пока окно открыто, страница под ним не прокручивается", () => {
    const { unmount } = renderViewer();
    expect(document.documentElement.style.overflow).toBe("hidden");
    unmount();
    expect(document.documentElement.style.overflow).toBe("");
  });
});
