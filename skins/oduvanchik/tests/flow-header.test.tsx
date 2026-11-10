// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FlowHeaderProps } from "@ykurilov/agent-chat-flows/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { oduvanchikFlowEditorSkin } from "../src/flows";

afterEach(cleanup);

const { FlowHeader } = oduvanchikFlowEditorSkin;

const header = (extra: Partial<FlowHeaderProps> = {}): FlowHeaderProps => ({
  name: "Продажа",
  onRename: vi.fn(),
  mode: "edit",
  onModeChange: vi.fn(),
  issues: { errors: 2, warnings: 0 },
  onAddState: vi.fn(),
  onOpenCard: vi.fn(),
  onOpenJson: vi.fn(),
  onOpenAnyState: vi.fn(),
  onOpenTestChat: vi.fn(),
  onSave: vi.fn(),
  saving: false,
  dirty: false,
  fullscreen: { active: false, onToggle: vi.fn() },
  ...extra,
});

describe("шапка редактора Одуванчика", () => {
  it("«Сохранено» — статус, а не выключенная кнопка", () => {
    render(<FlowHeader {...header()} />);
    const status = screen.getByRole("status", { name: "Сохранено" });
    expect(status.getAttribute("title")).toBe("Сохранено");
    expect(screen.queryByRole("button", { name: /Сохран/ })).toBeNull();
  });

  it("есть правки — живая кнопка «Сохранить»; после сохранения фокус переходит на статус", () => {
    const props = header({ dirty: true });
    const { rerender } = render(<FlowHeader {...props} />);
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save.hasAttribute("disabled")).toBe(false);
    save.focus();
    fireEvent.click(save);
    expect(props.onSave).toHaveBeenCalled();
    rerender(<FlowHeader {...props} dirty={false} />);
    expect(document.activeElement).toBe(screen.getByRole("status", { name: "Сохранено" }));
  });

  it("сохранение не удалось — кнопка повтора, а не статус", () => {
    render(<FlowHeader {...header({ dirty: false, saveFailed: true })} />);
    expect(screen.getByRole("button", { name: "Не сохранено" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("у каждой кнопки шапки есть имя и подсказка, даже когда подпись спрятана", () => {
    render(<FlowHeader {...header()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(6);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label"), button.outerHTML).toBeTruthy();
      expect(button.getAttribute("title"), button.outerHTML).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Проверить граф, Ошибок: 2" })).toBeTruthy();
  });

  it("подписи и меню «Ещё» зависят от ширины шапки, а не окна", () => {
    const css = readFileSync(join(import.meta.dirname, "../src/flows/styles.css"), "utf8");
    expect(css).toMatch(/\.oduvanchik-flow-header \{ container: oduvanchik-flow-header \/ inline-size; \}/);
    expect(css).toMatch(/@container oduvanchik-flow-header \(max-width: 460px\) \{[^}]*\.oduvanchik-flow-wide \{ display: none; \}\s*\.oduvanchik-flow-header \.oduvanchik-flow-more \{ display: block; \}/);
    // Средняя ширина (колонка рядом с конструктором): значки на виду, меню не нужно.
    const mid = css.match(/@container oduvanchik-flow-header \(max-width: 860px\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(mid).toContain("flex-wrap: wrap");
    expect(mid).not.toContain("oduvanchik-flow-more");
    expect(mid).not.toContain("oduvanchik-flow-wide");
    expect(css).not.toMatch(/@media \(max-width: 860px\) \{ \.oduvanchik-flow \.oduvanchik-flow-wide/);
    render(<FlowHeader {...header()} />);
    expect(document.querySelector(".oduvanchik-flow-header [data-flow-header-menu]")).toBeTruthy();
  });
});
