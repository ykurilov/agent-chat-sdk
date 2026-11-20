// @vitest-environment jsdom
import { TooltipProvider } from "@tandem/ui";
import { cleanup, fireEvent, render as renderBase, screen } from "@testing-library/react";
import type { ComposerAttachments } from "@ykurilov/agent-chat-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OduvanchikComposer } from "../src/composer";

/*
 * Обычное поле Одуванчика — одна строка и с меню «+»: «+» слева, текст, справа голос, кнопки приложения и «Отправить».
 * Раскладку (кнопки внизу при многострочном тексте, перенос на узком экране) проверяет браузерный тест; здесь — порядок.
 */

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const render = (node: ReactNode) => renderBase(node, { wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider> });
const attachments = (items: ComposerAttachments["items"] = []): ComposerAttachments => ({ items, onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "image/*" });
const base = () => ({ value: "", onValueChange: vi.fn(), onSubmit: vi.fn(), canSubmit: true, busy: false, onStop: vi.fn() });
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("поле Одуванчика в одну строку", () => {
  it("с меню «+»: «+» перед полем, «Отправить» после, поле в одну строку", () => {
    const { container } = render(<OduvanchikComposer {...base()} attachments={attachments()} />);
    const field = container.querySelector(".oduvanchik-field")!;
    expect(field.classList.contains("oduvanchik-field-inline")).toBe(true);
    const textbox = screen.getByRole("textbox");
    expect(before(screen.getByRole("button", { name: "Файл" }), textbox)).toBe(true);
    expect(before(textbox, screen.getByRole("button", { name: "Отправить" }))).toBe(true);
  });

  it("голос, голосовой режим, кнопки приложения и проект — тоже после поля, в той же строке", () => {
    const { container } = render(<OduvanchikComposer {...base()} attachments={attachments()}
      voice={{ state: "idle", onToggle: vi.fn() }}
      dialog={{ state: "off", speechAvailable: true, onToggle: vi.fn() }}
      actions={<button type="button">Проверить</button>}
      options={{ context: { label: "Проект", onPick: vi.fn() } }} />);
    expect(container.querySelector(".oduvanchik-field")!.classList.contains("oduvanchik-field-inline")).toBe(true);
    const textbox = screen.getByRole("textbox");
    for (const name of ["Проверить", "@ Проект", "Отправить"]) expect(before(textbox, screen.getByRole("button", { name }))).toBe(true);
    // Перед полем — только «+»; микрофон и голосовой режим — справа.
    const leading = [...container.querySelectorAll(".oduvanchik-field button")].filter((button) => before(button, textbox));
    expect(leading.map((button) => button.getAttribute("aria-label"))).toEqual(["Файл"]);
    expect(container.querySelectorAll(".oduvanchik-field-mic > button")).toHaveLength(2);
  });

  it("плашки файлов стоят над строкой, меню «+» открывается и выбирает файл", () => {
    const { container } = render(<OduvanchikComposer {...base()} attachments={attachments([{ id: "1", name: "кот.png", kind: "image", status: "uploading", progress: 0.4 }])} />);
    const files = container.querySelector(".oduvanchik-field-files")!;
    expect(before(files, screen.getByRole("button", { name: "Файл" }))).toBe(true);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    fireEvent.click(screen.getByRole("button", { name: "Файл" }));
    expect(screen.getByRole("button", { name: "Картинка" })).toBeTruthy();
  });

  it("тексту тесно — текст сверху во всю ширину, и Tab идёт так же, как видно: сначала текст, потом «+»", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("oduvanchik-field") ? 316 : 0; });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("oduvanchik-field-bar") ? 230 : this.classList.contains("oduvanchik-add") ? 36 : 0;
    });
    const { container } = render(<OduvanchikComposer {...base()} attachments={attachments()} />);
    expect(container.querySelector(".oduvanchik-field")!.hasAttribute("data-crowded")).toBe(true);
    const textbox = screen.getByRole("textbox");
    expect(before(textbox, screen.getByRole("button", { name: "Файл" }))).toBe(true);
    expect(before(screen.getByRole("button", { name: "Файл" }), screen.getByRole("button", { name: "Отправить" }))).toBe(true);
  });

  it("расширенное поле с настройками остаётся в две строки", () => {
    const { container } = render(<OduvanchikComposer {...base()} attachments={attachments()} options={{ variant: "extended" }} />);
    expect(container.querySelector(".oduvanchik-field")!.classList.contains("oduvanchik-field-inline")).toBe(false);
  });
});
