// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import type { ComponentProps, ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemAgentMessage } from "../src/agent-message";

afterEach(cleanup);

// Подсказку копирования рисует Тандем; в приложении провайдер стоит в `Layout` скина.
const message = (status: "streaming" | "complete"): ReactElement => (
  <TooltipProvider>
    <TandemAgentMessage status={status} onCopy={vi.fn()} empty={false} onRetry={vi.fn()} notice={null}>
      <p>Текст ответа</p>
    </TandemAgentMessage>
  </TooltipProvider>
);
const renderMessage = (status: "streaming" | "complete") => render(message(status));

/** Строка под пузырём: последний элемент колонки ответа. */
const rowUnderBubble = (container: HTMLElement) => container.querySelector("[data-status] > div:last-child > div:last-child")!;

describe("строка с кнопками под пузырём ответа", () => {
  it("пока ответ пишется, скрыта: её кнопки не находятся по роли", () => {
    renderMessage("streaming");

    expect(screen.queryByRole("button", { name: /копировать|copy/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /повторить|retry/i })).toBeNull();
  });

  it("после завершения видна: копирование и «повторить» находятся по роли", () => {
    renderMessage("complete");

    expect(screen.getByRole("button", { name: /копировать|copy/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /повторить|retry/i })).toBeTruthy();
  });

  it("стоит в дереве всегда и после пузыря: в конце ответа новый элемент не вставляется", () => {
    const { container, rerender } = renderMessage("streaming");
    const rowWhileStreaming = rowUnderBubble(container);
    const bubble = container.querySelector("[data-status] > div:last-child > div:first-child")!;

    expect(bubble.nextElementSibling).toBe(rowWhileStreaming);

    rerender(message("complete"));

    // Тот же элемент, а не новый: пузырь не меняет «последний ли он» в колонке.
    expect(rowUnderBubble(container)).toBe(rowWhileStreaming);
    expect(bubble.nextElementSibling).toBe(rowWhileStreaming);
  });
});

describe("свои кнопки приложения в ряду под ответом (договор 17)", () => {
  const withActions = (status: "streaming" | "complete", actions: ComponentProps<typeof TandemAgentMessage>["actions"]) => (
    <TooltipProvider>
      <TandemAgentMessage status={status} onCopy={vi.fn()} empty={false} {...(actions && { actions })}>
        <p>Текст ответа</p>
      </TandemAgentMessage>
    </TooltipProvider>
  );

  it("кнопка с иконкой — иконка с подписью для экранного диктора, нажатие зовёт onRun", () => {
    const onRun = vi.fn();
    render(withActions("complete", [{ id: "like", label: "Нравится", icon: <svg data-icon="heart" />, busy: false, onRun }]));
    const button = screen.getByRole("button", { name: "Нравится" });
    expect(button.querySelector('[data-icon="heart"]')).not.toBeNull();
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("кнопка без иконки — с подписью текстом", () => {
    render(withActions("complete", [{ id: "note", label: "В заметки", busy: false, onRun: vi.fn() }]));
    expect(screen.getByRole("button", { name: "В заметки" }).textContent).toBe("В заметки");
  });

  it("«занята» — неактивна и помечена aria-busy", () => {
    const onRun = vi.fn();
    render(withActions("complete", [{ id: "like", label: "Нравится", icon: <svg />, busy: true, onRun }]));
    const button = screen.getByRole("button", { name: "Нравится" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("пока ответ пишется, своих кнопок не видно", () => {
    render(withActions("streaming", [{ id: "like", label: "Нравится", busy: false, onRun: vi.fn() }]));
    expect(screen.queryByRole("button", { name: "Нравится" })).toBeNull();
  });
});

describe("ответ без текста (договор 34)", () => {
  const textless = (props: Partial<ComponentProps<typeof TandemAgentMessage>>, children?: ReactElement) => (
    <TooltipProvider>
      <TandemAgentMessage status="complete" onCopy={vi.fn()} empty={false} {...props}>
        {children}
      </TandemAgentMessage>
    </TooltipProvider>
  );

  it("строка из `emptyText` вместо «модель не дала ответа», без копирования и без отметки «Остановлено»", () => {
    render(textless({ status: "stopped", empty: true, emptyText: "Ответ остановлен до начала", onRetry: vi.fn() }));

    expect(screen.getByText("Ответ остановлен до начала")).toBeTruthy();
    expect(screen.queryByText("Модель не дала ответа")).toBeNull();
    expect(screen.queryByText("Остановлено")).toBeNull();
    expect(screen.queryByRole("button", { name: /копировать|copy/i })).toBeNull();
    expect(screen.getByRole("button", { name: /повторить|retry/i })).toBeTruthy();
  });

  it("`emptyText` пустой: только шаги, ни строки, ни копирования, ни пустого ряда кнопок", () => {
    const { container } = render(textless({ emptyText: "" }, <p>Посмотрел работу</p>));

    expect(screen.getByText("Посмотрел работу")).toBeTruthy();
    expect(screen.queryByText("Модель не дала ответа")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(rowUnderBubble(container).className).toContain("hidden");
  });

  it("без тела, только переключатель веток: аватар не виден, место под ним остаётся", () => {
    const { container } = render(textless({ emptyText: "", branchSwitcher: <span>1/2</span> }));
    const avatar = container.querySelector("[data-status] > :first-child")!;

    expect(screen.getByText("1/2")).toBeTruthy();
    expect(avatar.getAttribute("class")).toContain("invisible");
  });

  it("с телом аватар виден", () => {
    const { container } = render(textless({ emptyText: "" }, <p>Посмотрел работу</p>));

    expect(container.querySelector("[data-status] > :first-child")!.getAttribute("class")).not.toContain("invisible");
  });

  it("скин получает старый ответ без `emptyText`: как раньше по `empty`", () => {
    render(textless({ empty: true }));

    expect(screen.getByText("Модель не дала ответа")).toBeTruthy();
  });
});
