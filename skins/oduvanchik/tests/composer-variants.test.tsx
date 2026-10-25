import { TooltipProvider } from "@tandem/ui";
import type { ReactNode } from "react";
// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderBase, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OduvanchikComposer } from "../src/composer";
import type { ModelChoiceView } from "@ykurilov/agent-chat-react";

afterEach(cleanup);
const render = (node: ReactNode) => renderBase(node, { wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider> });
const choice = (onChange = vi.fn()): ModelChoiceView => ({
  providers: [{ id: "a", name: "Первый", models: [{ id: "one", name: "Первая", group: "Быстрые", price: { inputPerMillion: 1, outputPerMillion: 2 } }, { id: "two", name: "Вторая", group: "Умные" }] }, { id: "b", name: "Второй", models: [{ id: "one", name: "Первая", group: "Быстрые" }] }],
  current: { providerId: "a", modelId: "one" }, onChange, reasoning: "low", reasoningLevels: [{ id: "off", name: "Выкл" }, { id: "low", name: "Низко" }], onReasoningChange: vi.fn(),
});
const base = () => ({ value: "Текст", onValueChange: vi.fn(), onSubmit: vi.fn(), canSubmit: true, busy: false, onStop: vi.fn() });

describe("три вида поля Одуванчик", () => {
  it("поле, смонтированное в закрытой панели, сохраняет строку и растёт при фокусе после открытия", () => {
    const props = base();
    const { rerender } = render(<div hidden><OduvanchikComposer {...props} value="Первая\nВторая" /></div>);
    const field = screen.getByRole("textbox", { hidden: true }) as HTMLTextAreaElement;
    expect(field.style.height).toBe("auto");
    Object.defineProperty(field, "scrollHeight", { configurable: true, get: () => 96 });
    rerender(<div><OduvanchikComposer {...props} value="Первая\nВторая" /></div>);
    fireEvent.focus(field);
    expect(field.style.height).toBe("96px");
  });
  it("сжатое: текст и отправка без фишек, файлов и микрофона", () => {
    const props = base();
    const { container } = render(<OduvanchikComposer {...props} options={{ variant: "compact" }} modelChoice={choice()} voice={{ state: "idle", onToggle: vi.fn() }} />);
    expect(container.querySelector('[data-composer-variant="compact"]')).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("пустое и пробелы не отправляются даже при canSubmit, Shift+Enter и IME не отправляют", () => {
    const props = base();
    const { rerender } = render(<OduvanchikComposer {...props} value="   " />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
    rerender(<OduvanchikComposer {...props} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });
  it("без поддержки поправок во время ответа - Стоп; Enter не отправляет, фишки заблокированы", () => {
    const props = base();
    render(<OduvanchikComposer {...props} busy options={{ variant: "extended" }} modelChoice={choice()} />);
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Модель/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(props.onStop).toHaveBeenCalledOnce();
  });
  it.each(["compact", "standard", "extended"] as const)("%s: поправка отправляется рядом со Стопом, настройки остаются заблокированы", (variant) => {
    const props = base();
    const { rerender } = render(<OduvanchikComposer {...props} busy canSteer canSubmit={false} options={{ variant }} modelChoice={choice()} />);
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(props.onStop).toHaveBeenCalledOnce();
    if (variant === "extended") expect((screen.getByRole("button", { name: /Модель/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<OduvanchikComposer {...props} busy canSteer={false} options={{ variant }} />);
    expect((screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("button", { name: "Остановить" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("меню ищет модели, выбор сохраняет совместимого провайдера, через меняет провайдера", () => {
    const change = vi.fn();
    render(<OduvanchikComposer {...base()} options={{ variant: "extended" }} modelChoice={choice(change)} />);
    fireEvent.click(screen.getByRole("button", { name: /Модель/ }));
    expect(screen.getByText("Быстрые")).toBeTruthy();
    expect(screen.getByText("Умные")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Второй", exact: true }));
    expect(change).toHaveBeenCalledWith({ modelId: "one", providerId: "b" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Вторая" } });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /Первая/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Вторая/ }));
    expect(change).toHaveBeenLastCalledWith({ modelId: "two", providerId: "a" });
  });
  it("обычное: контекст, проект как вложение над текстом, микрофон у отправки", () => {
    const pick = vi.fn();
    const { container } = render(<OduvanchikComposer {...base()} options={{ variant: "standard", context: { label: "Мастерская", onPick: pick }, contextAttachments: [{ id: "p", label: "Проект", onRemove: vi.fn() }] }} voice={{ state: "idle", onToggle: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: /Мастерская/ }));
    expect(pick).toHaveBeenCalledOnce();
    const field = container.querySelector('textarea')!;
    const attachment = screen.getByText("Проект");
    expect(field.compareDocumentPosition(attachment) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(container.querySelector('.oduvanchik-field-mic + .oduvanchik-field-send')).not.toBeNull();
  });
});
