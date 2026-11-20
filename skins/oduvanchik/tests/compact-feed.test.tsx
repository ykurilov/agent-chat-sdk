// @vitest-environment jsdom
import { TooltipProvider } from "@tandem/ui";
import { cleanup, fireEvent, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OduvanchikAgentMessage } from "../src/agent-message";
import { OduvanchikToolCallGroup } from "../src/tool-call-group";
import { OduvanchikUserMessage } from "../src/user-message";
import { oduvanchikSkin } from "../src";

afterEach(cleanup);

const render = (node: ReactNode) => renderBase(node, { wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider> });

// Компактная лента (договор 37).
describe("Одуванчик: ответ, который продолжается следующим", () => {
  it("без «Копировать» и без нижнего промежутка; отметки и свои кнопки остаются", () => {
    const { container } = render(
      <OduvanchikAgentMessage status="complete" empty={false} onCopy={vi.fn()} continued edited actions={[{ id: "share", label: "Поделиться", busy: false, onRun: vi.fn() }]}>
        <p>Запустил генерацию.</p>
      </OduvanchikAgentMessage>,
    );
    expect(screen.queryByRole("button", { name: /копировать/i })).toBeNull();
    expect(screen.getByText("Поделиться")).toBeTruthy();
    const answer = container.querySelector(".oduvanchik-agent")!;
    expect(answer.hasAttribute("data-continued")).toBe(true);
    expect(answer.className).not.toContain("pb-6");
  });

  it("без отметок и кнопок ряд под ответом не занимает места", () => {
    const { container } = render(
      <OduvanchikAgentMessage status="complete" empty={false} onCopy={vi.fn()} continued>
        <p>Запустил генерацию.</p>
      </OduvanchikAgentMessage>,
    );
    expect(container.querySelector(".oduvanchik-answer-actions")).toBeNull();
  });

  it("обычный ответ — как раньше: «Копировать» и промежуток", () => {
    const { container } = render(
      <OduvanchikAgentMessage status="complete" empty={false} onCopy={vi.fn()}>
        <p>Готово.</p>
      </OduvanchikAgentMessage>,
    );
    expect(screen.getByRole("button", { name: /копировать/i })).toBeTruthy();
    expect(container.querySelector(".oduvanchik-agent")!.className).toContain("pb-6");
  });
});

describe("Одуванчик: одинаковые шаги подряд одной строкой", () => {
  it("строка «… ×4», для читалки — «…, 4 раза»; раскрывается по нажатию", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <OduvanchikToolCallGroup toolName="view_result" title="Посмотрел работу" count={4} open={false} onOpenChange={onOpenChange}>
        <p>строка вызова</p>
      </OduvanchikToolCallGroup>,
    );
    const button = screen.getByRole("button", { name: "Посмотрел работу: готово, 4 раза" });
    expect(button.textContent).toContain("×4");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("строка вызова")).toBeNull();
    // Закрытая строка не ссылается на список, которого нет на странице.
    expect(button.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(button);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <OduvanchikToolCallGroup toolName="view_result" title="Посмотрел работу" count={4} open onOpenChange={onOpenChange}>
        <p>строка вызова</p>
      </OduvanchikToolCallGroup>,
    );
    const opened = screen.getByRole("button", { name: "Посмотрел работу: готово, 4 раза" });
    expect(opened.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(opened.getAttribute("aria-controls")!)!.textContent).toBe("строка вызова");
  });

  it("строка группы — та же строка шага: приложение оформляет их одним правилом", () => {
    const { container } = render(
      <OduvanchikToolCallGroup toolName="view_result" count={2} open={false} onOpenChange={vi.fn()}>
        <p />
      </OduvanchikToolCallGroup>,
    );
    expect(container.querySelector('[data-tool-state="done"][data-tool-group] > button')).toBeTruthy();
  });

  it("скин отдаёт ToolCallGroup", () => {
    expect(oduvanchikSkin.ToolCallGroup).toBe(OduvanchikToolCallGroup);
  });
});

describe("Одуванчик: карандаш под репликой человека", () => {
  it("один карандаш — помечен для узкого экрана: встаёт слева от пузыря, отдельная строка не нужна", () => {
    const { container } = render(<OduvanchikUserMessage text="кот в цилиндре" onEdit={vi.fn()} />);
    expect(container.querySelector(".oduvanchik-user")!.hasAttribute("data-edit-beside")).toBe(true);
    expect(screen.getByRole("button", { name: /изменить/i })).toBeTruthy();
  });

  it("с переключателем веток, пометкой поправки или вложениями — строка под пузырём, как раньше", () => {
    const { container, rerender } = render(<OduvanchikUserMessage text="кот" onEdit={vi.fn()} branchSwitcher={<span>1/2</span>} />);
    expect(container.querySelector(".oduvanchik-user")!.hasAttribute("data-edit-beside")).toBe(false);
    rerender(<OduvanchikUserMessage text="кот" onEdit={vi.fn()} pending />);
    expect(container.querySelector(".oduvanchik-user")!.hasAttribute("data-edit-beside")).toBe(false);
    rerender(<OduvanchikUserMessage text="кот" onEdit={vi.fn()} attachments={{ label: "Вложения", items: [{ id: "f1", kind: "file", name: "a.pdf", url: "/a.pdf", mediaType: "application/pdf" }] }} />);
    expect(container.querySelector(".oduvanchik-user")!.hasAttribute("data-edit-beside")).toBe(false);
  });

  it("без карандаша пометки нет", () => {
    const { container } = render(<OduvanchikUserMessage text="кот" />);
    expect(container.querySelector(".oduvanchik-user")!.hasAttribute("data-edit-beside")).toBe(false);
  });
});
