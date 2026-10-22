// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerField } from "../src/composer-field";
import { OduvanchikWorkSteps } from "../src/work-steps";
import { oduvanchikSkin, oduvanchikMemorySkin } from "../src";

afterEach(cleanup);

describe("Одуванчик: договор 28", () => {
  it("подключает части ленты, голоса, панели и памяти", () => {
    expect(oduvanchikSkin.WorkSteps).toBe(OduvanchikWorkSteps);
    for (const part of [oduvanchikSkin.Layout, oduvanchikSkin.Composer, oduvanchikSkin.Widget, oduvanchikSkin.AgentPanel, oduvanchikSkin.MediaViewer, oduvanchikSkin.ServiceLine, oduvanchikMemorySkin.MemoryScreen]) expect(part).toBeTypeOf("function");
  });
  it("показывает items, неизвестный значок и +N, раскрывает список", () => {
    const change = vi.fn();
    const { container } = render(<OduvanchikWorkSteps state="done" count={12} steps={[]} open onOpenChange={change}
      icons={["read", "edit"]} moreIcons={10} items={[{ icon: "private-kind", phrase: "Свой шаг", failed: false }]} />);
    expect(container.querySelector('[data-work-step] [data-step-icon]')?.getAttribute("data-step-icon")).toBe("tool");
    expect(container.querySelector('[data-step-icons]')?.textContent).toContain("+10");
    fireEvent.click(screen.getByRole("button"));
    expect(change).toHaveBeenCalledWith(false);
  });
});

describe("Одуванчик: поле ввода", () => {
  it("не отправляет пустое поле, canSubmit разрешает отправить вложения", () => {
    const submit = vi.fn();
    const props = { value: "", onValueChange: vi.fn(), onSubmit: submit, canSubmit: false, busy: false, onStop: vi.fn() };
    const { rerender } = render(<ComposerField {...props} />);
    expect((screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    rerender(<ComposerField {...props} canSubmit attachments={{ items: [{ id: "a", name: "a", kind: "file", status: "ready" }], onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "*/*" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(submit).toHaveBeenCalledOnce();
  });
  it("IME и Shift+Enter не отправляют, Enter отправляет", () => {
    const submit = vi.fn();
    render(<ComposerField value="Текст" onValueChange={vi.fn()} onSubmit={submit} canSubmit />);
    const field = screen.getByRole("textbox");
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(submit).toHaveBeenCalledOnce();
  });
  it("сохраняет тот же textarea при появлении вложений и меню модели", () => {
    const props = { value: "Черновик", onValueChange: vi.fn(), onSubmit: vi.fn(), canSubmit: true };
    const { rerender } = render(<ComposerField {...props} />);
    const field = screen.getByRole("textbox");
    field.focus();
    rerender(<ComposerField {...props} attachments={{ items: [], onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "*/*" }} options={{ variant: "extended" }} />);
    expect(screen.getByRole("textbox")).toBe(field);
    expect(document.activeElement).toBe(field);
    expect((field as HTMLTextAreaElement).value).toBe("Черновик");
  });
  it("Стоп вызывает остановку, заблокированное поле не отправляет", () => {
    const stop = vi.fn();
    const submit = vi.fn();
    const { rerender } = render(<ComposerField value="Текст" onValueChange={vi.fn()} onSubmit={submit} canSubmit={false} busy onStop={stop} />);
    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(stop).toHaveBeenCalledOnce();
    rerender(<ComposerField value="Текст" onValueChange={vi.fn()} onSubmit={submit} canSubmit sendingBlocked />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
  });
});
