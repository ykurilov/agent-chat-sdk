// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { russianLabels } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemSkin } from "../src";
import { TandemAgentPanel, TandemAgentPanelLauncher } from "../src/agent-panel";

afterEach(cleanup);

describe("TandemAgentPanelLauncher", () => {
  const renderLauncher = (props: Partial<ComponentProps<typeof TandemAgentPanelLauncher>> = {}) => {
    const onToggle = vi.fn();
    render(<TandemAgentPanelLauncher open={false} busy={false} onToggle={onToggle} buttonRef={createRef()} {...props} />);
    return onToggle;
  };

  it("закрытая: подпись «Открыть агента», видимое слово «Агент», aria-expanded=false", () => {
    renderLauncher();
    const button = screen.getByRole("button", { name: russianLabels.agentPanelOpen });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toContain(russianLabels.agentPanelLauncher);
  });

  it("открытая: подпись «Закрыть панель агента», aria-expanded=true", () => {
    renderLauncher({ open: true });
    expect(screen.getByRole("button", { name: russianLabels.agentPanelClose }).getAttribute("aria-expanded")).toBe("true");
  });

  it("нажатие зовёт onToggle, buttonRef указывает на кнопку", () => {
    const buttonRef = createRef<HTMLButtonElement>();
    const onToggle = vi.fn();
    render(<TandemAgentPanelLauncher open={false} busy={false} onToggle={onToggle} buttonRef={buttonRef} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(buttonRef.current).toBe(screen.getByRole("button"));
  });

  it("значок «Агент отвечает» виден только при busy", () => {
    renderLauncher({ busy: false });
    expect(screen.queryByText(russianLabels.agentPanelBusy)).toBeNull();
    cleanup();
    renderLauncher({ busy: true });
    expect(screen.getByText(russianLabels.agentPanelBusy)).toBeTruthy();
  });

  it("не меньше 44 пунктов: такую кнопку нажимают на ходу", () => {
    renderLauncher();
    expect(screen.getByRole("button").style.minHeight).toBe("44px");
  });
});

describe("TandemAgentPanel", () => {
  const renderPanel = (props: Partial<ComponentProps<typeof TandemAgentPanel>> = {}) => {
    const handlers = { onListOpenChange: vi.fn(), onClose: vi.fn(), onEscape: vi.fn() };
    const view = render(
      <TandemAgentPanel
        open
        mode="overlay"
        width={420}
        title="Про Грецию"
        listOpen={false}
        {...handlers}
        list={<div data-testid="list">список чатов</div>}
        {...props}
      >
        <textarea aria-label="Сообщение" />
      </TandemAgentPanel>,
    );
    return { ...handlers, ...view };
  };

  it("открытая: область с подписью из словаря, без aria-modal, показывает название чата", () => {
    renderPanel();
    const panel = screen.getByRole("complementary", { name: russianLabels.agentPanelLabel });
    expect(panel.hasAttribute("aria-modal")).toBe(false);
        expect(screen.getByText("Про Грецию")).toBeTruthy();
  });

  it("закрытая: hidden и inert, но содержимое остаётся в разметке", () => {
    const { container } = renderPanel({ open: false });
    const panel = container.querySelector("aside")!;
    expect(panel.getAttribute("aria-label")).toBe(russianLabels.agentPanelLabel);
    expect(panel.hasAttribute("hidden")).toBe(true);
    expect(panel.hasAttribute("inert")).toBe(true);
        expect(screen.getByLabelText("Сообщение", { selector: "textarea" })).toBeTruthy();
  });

  it("без затемнения: нет фона-перекрытия и нет aria-modal", () => {
    const { container } = renderPanel();
    expect(container.querySelector("[data-agent-panel-backdrop]")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("ASIDE");
  });

  it("ширина берётся из width, режим — в data-mode", () => {
    renderPanel({ width: 480, mode: "push" });
    const panel = screen.getByRole("complementary");
    expect(panel.style.getPropertyValue("--agent-panel-width")).toBe("480px");
    expect(panel.getAttribute("data-mode")).toBe("push");
  });

  it("при переходе закрыта → открыта фокус уходит в поле ввода", () => {
    const { rerender, onClose, onEscape, onListOpenChange } = renderPanel({ open: false });
    expect(document.activeElement).toBe(document.body);
    rerender(
      <TandemAgentPanel open mode="overlay" width={420} title="Про Грецию" listOpen={false} onListOpenChange={onListOpenChange} onClose={onClose} onEscape={onEscape} list={null}>
        <textarea aria-label="Сообщение" />
      </TandemAgentPanel>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Сообщение", { selector: "textarea" }));
  });

  it("список закрылся, а фокус был в нём — фокус уходит в поле ввода: следующий Esc дойдёт до панели", () => {
    const props = { open: true, mode: "overlay" as const, width: 420, title: "Про Грецию", onListOpenChange: vi.fn(), onClose: vi.fn(), onEscape: vi.fn() };
    const list = <button type="button">Первый чат</button>;
    const { rerender } = render(
      <TandemAgentPanel {...props} listOpen list={list}>
        <textarea aria-label="Сообщение" />
      </TandemAgentPanel>,
    );
    screen.getByText("Первый чат").focus();
    rerender(
      <TandemAgentPanel {...props} listOpen={false} list={list}>
        <textarea aria-label="Сообщение" />
      </TandemAgentPanel>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Сообщение", { selector: "textarea" }));
  });

  it("список закрыли кнопкой «К чату» — фокус остаётся на ней", () => {
    const props = { open: true, mode: "overlay" as const, width: 420, title: "Про Грецию", onListOpenChange: vi.fn(), onClose: vi.fn(), onEscape: vi.fn() };
    const { rerender } = render(
      <TandemAgentPanel {...props} listOpen list={null}>
        <textarea aria-label="Сообщение" />
      </TandemAgentPanel>,
    );
    const toggle = screen.getByRole("button", { name: russianLabels.agentPanelBackToChat });
    toggle.focus();
    rerender(
      <TandemAgentPanel {...props} listOpen={false} list={null}>
        <textarea aria-label="Сообщение" />
      </TandemAgentPanel>,
    );
    expect(document.activeElement).toBe(toggle);
  });

  it("Esc внутри панели зовёт onEscape", () => {
    const { onEscape, onClose } = renderPanel();
    fireEvent.keyDown(screen.getByLabelText("Сообщение", { selector: "textarea" }), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc, уже обработанный вложенным элементом, onEscape не зовёт", () => {
    const { onEscape } = renderPanel();
    const field = screen.getByLabelText("Сообщение", { selector: "textarea" });
    field.addEventListener("keydown", (event) => event.preventDefault());
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("«Закрыть» видна всегда и зовёт onClose", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: russianLabels.agentPanelClose }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("список закрыт: поверх чата его нет, кнопка «Чаты» зовёт onListOpenChange(true)", () => {
    const { onListOpenChange } = renderPanel();
    expect(screen.queryByTestId("list")).toBeNull();
    const toggle = screen.getByRole("button", { name: russianLabels.agentPanelChats });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onListOpenChange).toHaveBeenCalledWith(true);
  });

  it("список открыт: виден поверх, чат под ним остаётся в разметке, но недоступен; кнопка «К чату»", () => {
    const { onListOpenChange } = renderPanel({ listOpen: true });
    expect(screen.getByTestId("list")).toBeTruthy();
    expect(screen.getByLabelText("Сообщение", { selector: "textarea" }).closest("[inert]")).not.toBeNull();
    const toggle = screen.getByRole("button", { name: russianLabels.agentPanelBackToChat });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(onListOpenChange).toHaveBeenCalledWith(false);
  });

  it("узкий экран: рамка на весь экран по классам (≤ 640 px), без горизонтальной прокрутки", () => {
    renderPanel();
    const panel = screen.getByRole("complementary");
    expect(panel.className).toMatch(/\bw-full\b/);
    expect(panel.className).toMatch(/min-\[641px\]:w-\[var\(--agent-panel-width\)\]/);
    expect(panel.className).toMatch(/overflow-x-hidden/);
  });

  it("светлая и тёмная тема: цвета только из переменных Тандема", () => {
    renderPanel();
    expect(screen.getByRole("complementary").className).toMatch(/var\(--surface\)/);
    expect(screen.getByRole("complementary").className).not.toMatch(/#[0-9a-f]{3,6}|\bbg-white\b|\bbg-black\b/i);
  });
});

describe("tandemSkin", () => {
  it("содержит скин панели агента (договор v12)", () => {
    expect(tandemSkin.AgentPanel).toBe(TandemAgentPanel);
    expect(tandemSkin.AgentPanelLauncher).toBe(TandemAgentPanelLauncher);
  });
});
