// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import { russianLabels, type ComposerAttachmentItem } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer } from "../src/composer";

/*
 * Плашки файлов рисует поле `Composer` из `@tandem/ui`, поля прогресса у него нет. Полосу прогресса скин ставит в плашку
 * сам. Тест — и страж вёрстки: плашки находятся по месту в поле, изменится вёрстка `@tandem/ui` — он упадёт.
 */

afterEach(cleanup);
const progress = russianLabels.uploadProgress!;

function renderComposer(items: ComposerAttachmentItem[]) {
  const props = { value: "", onValueChange: vi.fn(), onSubmit: vi.fn(), canSubmit: true, busy: false, onStop: vi.fn() };
  const attachments = (list: ComposerAttachmentItem[]) => ({ items: list, onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "image/*" });
  const view = render(<TooltipProvider><TandemComposer {...props} attachments={attachments(items)} /></TooltipProvider>);
  return (next: ComposerAttachmentItem[]) => view.rerender(<TooltipProvider><TandemComposer {...props} attachments={attachments(next)} /></TooltipProvider>);
}

const chip = (name: string) => screen.getByRole("button", { name: `Убрать ${name}` }).closest("li")!;
/** Текст плашки, который видно глазами: без спрятанного (`hidden`) и текста только для диктора. */
function visibleText(element: Element): string {
  if (element.hasAttribute("hidden") || element.classList.contains("sr-only")) return "";
  return [...element.childNodes].map((node) => (node.nodeType === Node.TEXT_NODE ? node.textContent : node instanceof Element ? visibleText(node) : "")).join(" ").replace(/\s+/g, " ").trim();
}
const spinnerShown = (name: string) => [...chip(name).querySelectorAll(".tandem-spinner")].some((spinner) => !spinner.closest("[hidden]"));

describe("Тандем: прогресс загрузки файла", () => {
  it("в плашке идущей загрузки — полоса прогресса с подписью; растёт с загрузкой и исчезает, когда файл готов", () => {
    const rerender = renderComposer([
      { id: "1", name: "кот.png", kind: "image", previewUrl: "blob:1", status: "uploading", progress: 0.2 },
      { id: "2", name: "заметки.txt", kind: "file", status: "uploading", progress: 0.7 },
      { id: "3", name: "ждёт.png", kind: "image", previewUrl: "blob:3", status: "uploading" },
    ]);
    const cat = screen.getByRole("progressbar", { name: progress.label("кот.png") });
    expect(chip("кот.png").contains(cat)).toBe(true);
    expect(cat.getAttribute("aria-valuenow")).toBe("20");
    expect(screen.getByRole("progressbar", { name: progress.label("заметки.txt") }).getAttribute("aria-valuenow")).toBe("70");
    expect(chip("ждёт.png").querySelector("[role=progressbar]")).toBeNull();

    rerender([
      { id: "1", name: "кот.png", kind: "image", previewUrl: "blob:1", status: "uploading", progress: 0.9 },
      { id: "2", name: "заметки.txt", kind: "file", status: "ready" },
      { id: "3", name: "ждёт.png", kind: "image", previewUrl: "blob:3", status: "uploading", progress: 0 },
    ]);
    expect(screen.getByRole("progressbar", { name: progress.label("кот.png") }).getAttribute("aria-valuenow")).toBe("90");
    expect(chip("заметки.txt").querySelector("[role=progressbar]")).toBeNull();
    expect(screen.getByRole("progressbar", { name: progress.label("ждёт.png") }).getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("файл убран из середины списка — полосы остаются у своих файлов", () => {
    const rerender = renderComposer([
      { id: "1", name: "a.png", kind: "image", previewUrl: "blob:1", status: "uploading", progress: 0.1 },
      { id: "2", name: "b.png", kind: "image", previewUrl: "blob:2", status: "uploading", progress: 0.5 },
    ]);
    rerender([{ id: "2", name: "b.png", kind: "image", previewUrl: "blob:2", status: "uploading", progress: 0.6 }]);
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(1);
    expect(chip("b.png").contains(bars[0]!)).toBe(true);
    expect(bars[0]!.getAttribute("aria-valuenow")).toBe("60");
  });

  it("процент текстом: у файла вместо «Загружается…», у картинки вместо значка ожидания; на 100 % — снова «Загружается…»", () => {
    const rerender = renderComposer([
      { id: "1", name: "кот.png", kind: "image", previewUrl: "blob:1", status: "uploading", progress: 0.46 },
      { id: "2", name: "заметки.txt", kind: "file", status: "uploading", progress: 0.7 },
    ]);
    expect(visibleText(chip("заметки.txt"))).toContain(`заметки.txt ${progress.percent(70)}`.replace(/\s+/g, " "));
    expect(visibleText(chip("заметки.txt"))).not.toContain("Загружается");
    expect(visibleText(chip("кот.png"))).toContain(progress.percent(46).replace(/\s+/g, " "));
    expect(spinnerShown("кот.png")).toBe(false);

    rerender([
      { id: "1", name: "кот.png", kind: "image", previewUrl: "blob:1", status: "uploading", progress: 1 },
      { id: "2", name: "заметки.txt", kind: "file", status: "uploading", progress: 1 },
    ]);
    expect(visibleText(chip("заметки.txt"))).toContain("Загружается…");
    expect(visibleText(chip("заметки.txt"))).not.toContain("%");
    expect(visibleText(chip("кот.png"))).not.toContain("%");
    expect(spinnerShown("кот.png")).toBe(true);
    expect(screen.getByRole("progressbar", { name: progress.label("кот.png") }).getAttribute("aria-valuenow")).toBe("100");

    rerender([
      { id: "1", name: "кот.png", kind: "image", previewUrl: "blob:1", status: "ready" },
      { id: "2", name: "заметки.txt", kind: "file", status: "ready" },
    ]);
    expect(visibleText(chip("заметки.txt"))).not.toMatch(/Загружается|%/);
    expect(visibleText(chip("кот.png"))).toBe("");
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("полоса стоит внутри плашки: плашка — точка отсчёта для полосы", () => {
    renderComposer([{ id: "1", name: "заметки.txt", kind: "file", status: "uploading", progress: 0.3 }]);
    const bar = screen.getByRole("progressbar");
    expect(bar.parentElement).toBe(chip("заметки.txt"));
    expect(bar.style.position).toBe("absolute");
    expect(chip("заметки.txt").className.split(/\s+/).includes("relative") || chip("заметки.txt").style.position === "relative").toBe(true);
  });
});
