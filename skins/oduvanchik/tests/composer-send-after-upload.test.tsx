import { TooltipProvider } from "@tandem/ui";
import type { ReactNode } from "react";
// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderBase, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OduvanchikComposer } from "../src/composer";
import { ChatLabelsProvider, englishLabels, russianLabels, type ComposerAttachments } from "@ykurilov/agent-chat-react";

afterEach(cleanup);
const render = (node: ReactNode) => renderBase(node, { wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider> });
const uploading = (): ComposerAttachments => ({
  items: [{ id: "1", name: "скрин.png", kind: "image", status: "uploading" }],
  onAddFiles: vi.fn(),
  onRemove: vi.fn(),
  accept: "image/*",
});
const base = () => ({ value: "Что на скрине?", onValueChange: vi.fn(), onSubmit: vi.fn(), canSubmit: true, busy: false, onStop: vi.fn(), attachments: uploading() });
const waiting = russianLabels.sendAfterUpload!;

describe("Одуванчик: «Отправить» во время загрузки файла", () => {
  it("пока файл грузится, кнопка и Enter пропускают нажатие к слою поведения", () => {
    const props = base();
    render(<OduvanchikComposer {...props} />);
    const send = screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledTimes(2);
  });

  it("ожидание: строка для глаз и диктора, кнопка отправки занята, но фокус не теряет; повторное нажатие не шлёт", () => {
    const props = base();
    render(<OduvanchikComposer {...props} pendingSend={{ onCancel: vi.fn() }} />);
    expect(screen.getByRole("status").textContent).toContain(waiting.waiting);
    const send = screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(send.getAttribute("aria-busy")).toBe("true");
    expect(send.getAttribute("aria-describedby")).toBe(screen.getByText(waiting.waiting).id);
    fireEvent.click(send);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("«Не отправлять» вызывает onCancel", () => {
    const onCancel = vi.fn();
    render(<OduvanchikComposer {...base()} pendingSend={{ onCancel }} />);
    fireEvent.click(screen.getByRole("button", { name: waiting.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("область для диктора стоит заранее и без ожидания пуста; без вложений её нет", () => {
    const { rerender } = render(<OduvanchikComposer {...base()} />);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("button", { name: waiting.cancel })).toBeNull();
    const { attachments: _ignored, ...plain } = base();
    rerender(<OduvanchikComposer {...plain} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("английский словарь — английские надписи ожидания", () => {
    render(
      <ChatLabelsProvider labels={englishLabels}>
        <OduvanchikComposer {...base()} pendingSend={{ onCancel: vi.fn() }} />
      </ChatLabelsProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain(englishLabels.sendAfterUpload!.waiting);
    expect(screen.getByRole("button", { name: englishLabels.sendAfterUpload!.cancel })).toBeTruthy();
  });
});
