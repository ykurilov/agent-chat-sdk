// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import type { ComposerAttachments } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer } from "../src/composer";

afterEach(cleanup);

const attachmentsView = (override: Partial<ComposerAttachments> = {}): ComposerAttachments => ({
  items: [
    { id: "1", name: "кот.png", kind: "image", status: "ready", previewUrl: "blob:cat" },
    { id: "2", name: "счёт.pdf", kind: "file", status: "uploading" },
  ],
  onAddFiles: vi.fn(),
  onRemove: vi.fn(),
  accept: "image/png,.pdf",
  ...override,
});

function renderComposer(props: Partial<ComponentProps<typeof TandemComposer>> = {}) {
  return render(
    <TooltipProvider>
      <TandemComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

describe("поле ввода Тандема: вложения", () => {
  it("без вложений скрепки нет: чат остаётся текстовым", () => {
    renderComposer();
    expect(screen.queryByRole("button", { name: /Прикрепить/ })).toBeNull();
  });

  it("со вложениями есть скрепка, превью файлов и кнопка «Убрать»; микрофона нет", () => {
    const attachments = attachmentsView();
    renderComposer({ attachments });

    expect(screen.getByRole("button", { name: /Прикрепить/ })).toBeTruthy();
    expect(screen.getByAltText("кот.png")).toBeTruthy();
    expect(screen.getByText("счёт.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Убрать счёт.pdf" }));
    expect(attachments.onRemove).toHaveBeenCalledWith("2");
  });

  it("голоса в этом чате нет — микрофона нет вовсе (встроенный Тандема не подключён), кнопка «Отправить» осталась", () => {
    const { container } = renderComposer({ attachments: attachmentsView() });
    expect(screen.queryByRole("button", { name: /Надиктовать|Диктовать/ })).toBeNull();
    expect(container.querySelector('[class*="button:first-child]:hidden"]')).toBeNull();
    expect(screen.getByRole("button", { name: /Отправить/ })).toBeTruthy();
  });

  it("выбранные файлы уходят в onAddFiles, а список допустимых типов — в поле выбора", () => {
    const attachments = attachmentsView({ items: [] });
    const { container } = renderComposer({ attachments });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe("image/png,.pdf");
    const file = new File(["x"], "заметки.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(attachments.onAddFiles).toHaveBeenCalledWith([file]);
  });

  it("сообщение о вложениях видно человеку со ролью «alert»", () => {
    renderComposer({ attachments: attachmentsView({ notice: "Эта модель не видит картинки" }) });
    expect(screen.getByRole("alert").textContent).toContain("Эта модель не видит картинки");
  });

  it("выбор модели работает и со вложениями", () => {
    renderComposer({
      attachments: attachmentsView(),
      modelChoice: {
        providers: [{ id: "openrouter", name: "OpenRouter", models: [{ id: "luna", name: "GPT 6 Luna" }] }],
        current: { providerId: "openrouter", modelId: "luna" },
        onChange: vi.fn(),
        reasoningLevels: [],
        reasoning: "",
        onReasoningChange: vi.fn(),
      },
    });
    expect(screen.getByText("GPT 6 Luna")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Прикрепить/ })).toBeTruthy();
  });

  const hideModelPicker = '[class*="button[aria-haspopup=menu]]:hidden"]';

  it("пока список моделей не пришёл (или моделей нет), пустой выбор «Выберите модель» спрятан правилом на обёртке", () => {
    const { container, unmount } = renderComposer({ attachments: attachmentsView() });
    expect(container.querySelector(hideModelPicker)).toBeTruthy();
    unmount();
    const loading = renderComposer({
      attachments: attachmentsView(),
      modelChoice: { providers: [], current: { providerId: "", modelId: "" }, onChange: vi.fn(), reasoningLevels: [], reasoning: "", onReasoningChange: vi.fn() },
    });
    expect(loading.container.querySelector(hideModelPicker)).toBeTruthy();
  });

  it("когда список пришёл, выбор модели на виду: прятать нечего", () => {
    const { container } = renderComposer({
      attachments: attachmentsView(),
      modelChoice: {
        providers: [{ id: "openrouter", name: "OpenRouter", models: [{ id: "luna", name: "GPT 6 Luna" }] }],
        current: { providerId: "openrouter", modelId: "luna" },
        onChange: vi.fn(),
        reasoningLevels: [],
        reasoning: "",
        onReasoningChange: vi.fn(),
      },
    });
    expect(container.querySelector(hideModelPicker)).toBeNull();
  });
});

