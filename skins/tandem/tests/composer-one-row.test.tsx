// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import type { ComposerAttachments, ModelChoiceView } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer, findNativeSend } from "../src/composer";

/*
 * Поле Тандема со скрепкой, но без меню моделей — в одну строку: скрепка слева, текст, справа кнопки и «Отправить».
 * Дерево `@tandem/ui` не меняется (порядок задают стили рамки), раскладку проверяет браузерный тест; здесь — что рамка
 * получила раскладку в строку, а родная «Отправить» по-прежнему находится.
 */

afterEach(cleanup);

const attachments = (): ComposerAttachments => ({ items: [{ id: "1", name: "кот.png", kind: "image", status: "ready", previewUrl: "blob:cat" }], onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "image/*" });
const modelChoice: ModelChoiceView = { providers: [{ id: "a", name: "A", models: [{ id: "m", name: "M" }] }], current: { providerId: "a", modelId: "m" }, onChange: vi.fn(), reasoning: "", reasoningLevels: [], onReasoningChange: vi.fn() };

function renderComposer(props: Partial<ComponentProps<typeof TandemComposer>> = {}) {
  return render(
    <TooltipProvider>
      <TandemComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit busy={false} onStop={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}
const frameOf = () => screen.getByRole("textbox").parentElement!;

describe("поле Тандема в одну строку", () => {
  it("со скрепкой и без меню моделей рамка раскладывает поле в строку; «Отправить» одна", () => {
    const { container } = renderComposer({ attachments: attachments() });
    expect(frameOf().classList.contains("tandem-single-row")).toBe(true);
    expect(screen.getByRole("button", { name: /Прикрепить/ })).toBeTruthy();
    expect(findNativeSend(container)).toHaveLength(1);
  });

  it("без вложений и меню — тоже одна строка", () => {
    renderComposer();
    expect(frameOf().classList.contains("tandem-single-row")).toBe(true);
  });

  it("с меню моделей ряд под полем остаётся", () => {
    renderComposer({ attachments: attachments(), modelChoice });
    expect(frameOf().classList.contains("tandem-single-row")).toBe(false);
  });
});
