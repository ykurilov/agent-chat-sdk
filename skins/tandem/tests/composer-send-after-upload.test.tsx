// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import { russianLabels, type ComposerAttachments } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findNativeSend, TandemComposer } from "../src/composer";

afterEach(cleanup);

const uploading = (): ComposerAttachments => ({
  items: [{ id: "1", name: "скрин.png", kind: "image", status: "uploading" }],
  onAddFiles: vi.fn(),
  onRemove: vi.fn(),
  accept: "image/*",
});
const waiting = russianLabels.sendAfterUpload!;

function renderComposer(props: Partial<ComponentProps<typeof TandemComposer>> = {}) {
  const all = { value: "Что на скрине?", onValueChange: vi.fn(), onSubmit: vi.fn(), canSubmit: true, busy: false, onStop: vi.fn(), attachments: uploading(), ...props };
  render(
    <TooltipProvider>
      <TandemComposer {...all} />
    </TooltipProvider>,
  );
  return all;
}

/** Видимая кнопка «Отправить»: во время загрузки — своя кнопка скина, а родная кнопка поля Тандема спрятана. */
const visibleSend = () => {
  const own = document.querySelector<HTMLButtonElement>("[data-send-while-uploading]");
  if (own) {
    expect(own.closest("[data-native-send-hidden]")).not.toBeNull();
    return own;
  }
  const all = screen.getAllByRole("button", { name: "Отправить" });
  expect(all).toHaveLength(1);
  return all[0] as HTMLButtonElement;
};

describe("Тандем: «Отправить» во время загрузки файла", () => {
  it("пока файл грузится, кнопка «Отправить» и Enter пропускают нажатие к слою поведения — один раз", () => {
    const props = renderComposer();
    const send = visibleSend();
    expect(screen.getAllByRole("button", { name: "Отправить" })).toEqual([send]);
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledTimes(2);
  });

  it("Shift+Enter во время загрузки не отправляет", () => {
    const props = renderComposer();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("слой поведения не разрешает отправку (canSubmit false) — нажатие не проходит", () => {
    const props = renderComposer({ canSubmit: false });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("ожидание: строка для глаз и диктора, кнопка занята; повторное нажатие не шлёт, «Не отправлять» вызывает onCancel", () => {
    const onCancel = vi.fn();
    const props = renderComposer({ pendingSend: { onCancel } });
    expect(screen.getByRole("status").textContent).toContain(waiting.waiting);
    const send = visibleSend();
    expect(send.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(send);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: waiting.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("файлы загружены — своей кнопки нет, работает родная кнопка поля", () => {
    const props = renderComposer({ attachments: { ...uploading(), items: [{ id: "1", name: "скрин.png", kind: "image", status: "ready" }] } });
    expect(document.querySelector("[data-send-while-uploading]")).toBeNull();
    fireEvent.click(visibleSend());
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("страж вёрстки @tandem/ui: адрес родной кнопки находит ровно одну «Отправить» — и в загрузке, и без неё, и при поправке", () => {
    const ready = { ...uploading(), items: [{ id: "1", name: "скрин.png", kind: "image" as const, status: "ready" as const }] };
    const cases: Array<Partial<ComponentProps<typeof TandemComposer>>> = [
      {},
      { attachments: ready },
      { busy: true, canSteer: true },
    ];
    for (const props of cases) {
      const { container, unmount } = render(
        <TooltipProvider>
          <TandemComposer value="Текст" onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit busy={false} onStop={vi.fn()} attachments={uploading()} {...props} />
        </TooltipProvider>,
      );
      const found = findNativeSend(container);
      expect(found).toHaveLength(1);
      expect(found[0]!.getAttribute("aria-label")).toBe("Отправить");
      unmount();
    }
  });

  it("Enter в чужом поле внутри обёртки (кнопки приложения) не отправляет, даже во время загрузки", () => {
    const props = renderComposer({ actions: <textarea aria-label="заметка приложения" /> });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "заметка приложения" }), { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
