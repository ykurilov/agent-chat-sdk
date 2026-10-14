// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseFlow } from "@ykurilov/agent-chat-flows/format";
import { FlowEditor, type FlowEditorProps } from "@ykurilov/agent-chat-flows/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import salesReview from "../../../packages/flows/tests/fixtures/sales-review.json";
import { tandemFlowEditorSkin } from "../src/flows";

// Место доски в скине Тандема: узкая шапка, легенда, панель «Сценарий», мини-карта, полный экран.

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.DOMMatrixReadOnly ??= class {
  m22 = 1;
} as unknown as typeof DOMMatrixReadOnly;

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const parsed = parseFlow(salesReview);
if (!parsed.ok) throw new Error("пример не разобран");
const catalog = { tools: [], events: [], widgets: [] };

function editor(props: Partial<FlowEditorProps> = {}) {
  return render(<FlowEditor skin={tandemFlowEditorSkin} value={parsed.flow} onChange={vi.fn()} catalog={catalog} {...props} />);
}

describe("доска сценария: место", () => {
  it("по умолчанию шапка полная, легенда свёрнута в кнопку, панель и мини-карта открыты", () => {
    const { container } = editor();
    expect(screen.getByRole("textbox", { name: parsed.flow.name })).toBeTruthy();
    const legend = screen.getByRole("button", { name: "Легенда" });
    expect(legend.getAttribute("aria-expanded")).toBe("false");
    const legendBox = () => container.querySelector(".flow-board__legend")!;
    expect(legendBox().querySelector("ul")).toBeNull();
    expect(screen.getByRole("button", { name: "Скрыть панель «Сценарий»" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Скрыть мини-карту" })).toBeTruthy();
    expect(container.querySelector("aside")).not.toBeNull();
    fireEvent.click(legend);
    expect(legendBox().querySelector("ul")).not.toBeNull();
    expect(legend.getAttribute("aria-expanded")).toBe("true");
  });

  it("header=compact: нет названия и логотипа, кнопки на месте", () => {
    editor({ header: "compact" });
    expect(screen.queryByRole("textbox", { name: parsed.flow.name })).toBeNull();
    expect(screen.getByRole("button", { name: /Проверить граф/ })).toBeTruthy();
    expect(document.querySelector("[data-flow-editor]")?.getAttribute("data-flow-compact")).toBe("");
  });

  it("панель сворачивается и запоминается; холст остаётся на месте", () => {
    const first = editor();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть панель «Сценарий»" }));
    expect(first.container.querySelector("aside")).toBeNull();
    expect(screen.getByRole("button", { name: "Показать панель «Сценарий»" })).toBeTruthy();
    first.unmount();
    const second = editor();
    expect(second.container.querySelector("aside")).toBeNull();
  });

  it("inspector=collapsible: свёрнута, пока ничего не выбрано; «Карточка» раскрывает", () => {
    const { container } = editor({ inspector: "collapsible" });
    expect(container.querySelector("aside")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Карточка и заметки/ }));
    expect(container.querySelector("aside")).not.toBeNull();
  });

  it("мини-карта сворачивается кнопкой и запоминается; minimap=hidden убирает кнопку", () => {
    const first = editor();
    expect(first.container.querySelector(".react-flow__minimap")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть мини-карту" }));
    expect(first.container.querySelector(".react-flow__minimap")).toBeNull();
    first.unmount();
    const second = editor();
    expect(second.container.querySelector(".react-flow__minimap")).toBeNull();
    second.unmount();
    window.localStorage.clear();
    editor({ minimap: "hidden", legend: "hidden" });
    expect(screen.queryByRole("button", { name: /мини-карту/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Легенда" })).toBeNull();
  });

  it("полный экран: кнопка в шапке, Esc выходит, страница не прокручивается", () => {
    document.body.style.overflow = "auto";
    editor();
    const button = screen.getByRole("button", { name: "На весь экран" });
    fireEvent.click(button);
    const region = screen.getByRole("dialog", { name: "Редактор сценария на весь экран" });
    expect(region.hasAttribute("data-flow-fullscreen")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Выйти из полного экрана" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Редактор сценария на весь экран" })).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "На весь экран" }));

    fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    fireEvent.click(screen.getByRole("button", { name: "Выйти из полного экрана" }));
    expect(screen.queryByRole("dialog", { name: "Редактор сценария на весь экран" })).toBeNull();
    document.body.style.overflow = "";
  });

  it("Esc при открытом окне JSON закрывает только его", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Редактор сценария на весь экран" })).toBeTruthy();
  });

  it("Tab в окне JSON поверх полного экрана не отменяется", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    const field = screen.getByRole("textbox", { name: "Граф в формате JSON" });
    field.focus();
    // fireEvent возвращает false, если обработчик вызвал preventDefault.
    expect(fireEvent.keyDown(field, { key: "Tab" })).toBe(true);
  });

  it("в проверке графа кнопки «Скрыть панель» нет, выбор не записывается", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: /Проверить граф/ }));
    expect(screen.queryByRole("button", { name: "Скрыть панель «Сценарий»" })).toBeNull();
    expect(window.localStorage.getItem("agent-chat-flow-board")).toBeNull();
  });

  it("fullscreen=false: кнопки нет", () => {
    editor({ fullscreen: false });
    expect(screen.queryByRole("button", { name: "На весь экран" })).toBeNull();
  });
});
