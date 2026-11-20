// @vitest-environment jsdom
import { TooltipProvider } from "@tandem/ui";
import { cleanup, fireEvent, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemAgentMessage } from "../src/agent-message";
import { TandemToolCallGroup } from "../src/tool-call-group";
import { tandemSkin } from "../src";

afterEach(cleanup);

const render = (node: ReactNode) => renderBase(node, { wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider> });

// Компактная лента (договор 37).
describe("Тандем: цепочка ответов", () => {
  it("ответ, который продолжается следующим, — без «Копировать» и без нижнего промежутка", () => {
    const { container } = render(
      <TandemAgentMessage status="complete" empty={false} onCopy={vi.fn()} continued>
        <p>Запустил генерацию.</p>
      </TandemAgentMessage>,
    );
    expect(screen.queryByRole("button", { name: /копировать/i })).toBeNull();
    expect(container.querySelector("[data-status]")!.className).not.toContain("pb-6");
  });

  it("ответ, который продолжает прошлый, — без второго аватара: место под ним остаётся", () => {
    const { container } = render(
      <TandemAgentMessage status="complete" empty={false} onCopy={vi.fn()} followsPrevious>
        <p>Обе работы готовы.</p>
      </TandemAgentMessage>,
    );
    const avatar = container.querySelector("[data-status] > :first-child")!;
    expect(avatar.getAttribute("class")).toContain("invisible");
    expect(screen.getByRole("button", { name: /копировать/i })).toBeTruthy();
  });
});

describe("Тандем: одинаковые шаги подряд одной строкой", () => {
  it("строка «… ×3», для читалки — «…, 3 раза»; раскрывается по нажатию", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <TandemToolCallGroup toolName="web_search" count={3} open={false} onOpenChange={onOpenChange}>
        <p>строка вызова</p>
      </TandemToolCallGroup>,
    );
    const button = screen.getByRole("button", { name: "web_search: готово, 3 раза" });
    expect(button.textContent).toContain("×3");
    expect(screen.queryByText("строка вызова")).toBeNull();
    // Закрытая строка не ссылается на список, которого нет на странице.
    expect(button.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(button);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <TandemToolCallGroup toolName="web_search" count={3} open onOpenChange={onOpenChange}>
        <p>строка вызова</p>
      </TandemToolCallGroup>,
    );
    const opened = screen.getByRole("button", { name: "web_search: готово, 3 раза" });
    expect(opened.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(opened.getAttribute("aria-controls")!)!.textContent).toBe("строка вызова");
  });

  it("скин отдаёт ToolCallGroup", () => {
    expect(tandemSkin.ToolCallGroup).toBe(TandemToolCallGroup);
  });
});
