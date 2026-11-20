import { TooltipProvider } from "@tandem/ui";
import type { ReactNode } from "react";
// @vitest-environment jsdom
import { cleanup, render as renderBase, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatLabelsProvider, englishLabels, russianLabels, type ComposerAttachmentItem, type ComposerAttachments } from "@ykurilov/agent-chat-react";
import { OduvanchikComposer } from "../src/composer";

/*
 * Сборка приложения может оставить у значков Phosphor только обычное и залитое начертание (так собрана Творелла).
 * Значок другого начертания тогда рисуется пустым: кнопка отправки — сплошной круг без стрелки. Подмена ниже делает то же.
 */
vi.mock("@phosphor-icons/react", async (importOriginal) => {
  const { createElement, forwardRef } = await import("react");
  const real = await importOriginal<Record<string, unknown>>();
  const kept = new Set([undefined, "regular", "fill"]);
  return Object.fromEntries(Object.entries(real).map(([name, value]) => [name,
    name.endsWith("Icon") && typeof value === "object"
      ? forwardRef<SVGSVGElement, { weight?: string }>((props, ref) =>
        kept.has(props.weight) ? createElement(value as never, { ...props, ref }) : createElement("svg", { ref, "data-weight-stripped": "" }))
      : value]));
});

afterEach(cleanup);
const render = (node: ReactNode) => renderBase(node, { wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider> });
const files = (...items: ComposerAttachmentItem[]): ComposerAttachments => ({ items, onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "image/*" });
const base = (attachments: ComposerAttachments, value = "") => ({ value, onValueChange: vi.fn(), onSubmit: vi.fn(), canSubmit: true, busy: false, onStop: vi.fn(), attachments });
const progress = russianLabels.uploadProgress!;

describe("Одуванчик: прогресс загрузки файла", () => {
  it("у идущей загрузки — полоса прогресса с подписью для диктора и процент на плашке", () => {
    render(<OduvanchikComposer {...base(files({ id: "1", name: "кот.png", kind: "image", previewUrl: "blob:1", status: "uploading", progress: 0.456 }))} />);
    const bar = screen.getByRole("progressbar", { name: progress.label("кот.png") });
    expect(bar.getAttribute("aria-valuenow")).toBe("46");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    const chip = screen.getByRole("list", { name: "Вложения" }).querySelector("li")!;
    // Сравнение текста напрямую: поиск по тексту заменил бы неразрывный пробел перед «%» обычным.
    expect(chip.querySelector("span")!.textContent).toBe(`кот.png · ${progress.percent(46)}`);
  });

  it("прогресс неизвестен (файл ждёт очереди или транспорт приложения его не сообщает) — плашка как раньше; готовый файл — без полосы", () => {
    render(<OduvanchikComposer {...base(files(
      { id: "1", name: "a.png", kind: "image", status: "uploading" },
      { id: "2", name: "b.png", kind: "image", status: "ready" },
    ))} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/a\.png · Загружается…/)).toBeTruthy();
    expect(screen.getByText("b.png")).toBeTruthy();
  });

  it("всё отправлено, сервер ещё разбирает файл — вместо «100 %» снова «Загружается…», полоса полная", () => {
    render(<OduvanchikComposer {...base(files({ id: "1", name: "a.png", kind: "image", status: "uploading", progress: 1 }))} />);
    expect(screen.getByRole("progressbar", { name: progress.label("a.png") }).getAttribute("aria-valuenow")).toBe("100");
    const chip = screen.getByRole("list", { name: "Вложения" }).querySelector("li")!;
    expect(chip.querySelector("span")!.textContent).toBe("a.png · Загружается…");
  });

  it("английский словарь — английская подпись полосы", () => {
    render(
      <ChatLabelsProvider labels={englishLabels}>
        <OduvanchikComposer {...base(files({ id: "1", name: "cat.png", kind: "image", status: "uploading", progress: 0.5 }))} />
      </ChatLabelsProvider>,
    );
    expect(screen.getByRole("progressbar", { name: englishLabels.uploadProgress!.label("cat.png") }).getAttribute("aria-valuenow")).toBe("50");
  });
});

describe("Одуванчик: стрелка отправки", () => {
  it.each([
    ["после загрузки одних картинок, без текста", ""],
    ["с текстом", "Что на фото?"],
  ])("%s: на кнопке нарисована стрелка, даже если сборка приложения оставила у значков только обычное начертание", (_case, value) => {
    render(<OduvanchikComposer {...base(files({ id: "1", name: "кот.png", kind: "image", status: "ready" }), value)} />);
    const send = screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(send.querySelector("svg path")?.getAttribute("d")).toBeTruthy();
  });
});
