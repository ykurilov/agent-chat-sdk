// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemSkin } from "../src";
import { TandemWorkSteps } from "../src/work-steps";

afterEach(cleanup);

const steps = [
  { phrase: "Сделал календарь", failed: false },
  { phrase: "Проверил на телефоне", failed: false },
  { phrase: "Выкладываю — не вышло", failed: true },
];

describe("простой вид работы агента в Тандеме", () => {
  it("скин подключает WorkSteps (договор 23)", () => {
    expect(tandemSkin.WorkSteps).toBe(TandemWorkSteps);
  });

  it("живая строка — текущий шаг с многоточием, без кнопок; диктор слышит одно «Работаю…», а не каждую фразу", () => {
    const { container, rerender } = render(<TandemWorkSteps state="live" phrase="Рисую календарь…" />);
    expect(container.querySelector("[data-work-live]")?.textContent).toContain("Рисую календарь…");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Работаю…");
    expect(container.querySelector("[data-work-phrase]")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<TandemWorkSteps state="live" phrase="Проверяю на телефоне…" />);
    expect(screen.getByRole("status").textContent).toBe("Работаю…");
  });

  it("свёрнутые шаги — одна строка «Сделано N шагов», список скрыт", () => {
    const onOpenChange = vi.fn();
    render(<TandemWorkSteps state="done" steps={steps} count={3} open={false} onOpenChange={onOpenChange} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.textContent).toContain("Сделано 3 шага");
    expect(screen.queryByText("Сделал календарь")).toBeNull();
    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("раскрытые — список понятных фраз, неудачный шаг отмечен", () => {
    const { container } = render(<TandemWorkSteps state="done" steps={steps} count={4} open onOpenChange={vi.fn()} />);
    const items = [...container.querySelectorAll("[data-work-step]")];
    expect(items.map((item) => item.textContent)).toEqual(["Сделал календарь", "Проверил на телефоне", "Выкладываю — не вышло"]);
    expect(items.map((item) => item.getAttribute("data-failed"))).toEqual(["false", "false", "true"]);
    expect(screen.getByRole("button", { expanded: true }).getAttribute("aria-controls")).toBe(container.querySelector("ol")?.id);
    expect(screen.getByRole("button", { expanded: true }).textContent).toContain("Сделано 4 шага");
    // Длинная фраза без пробелов переносится внутри пузыря.
    expect(items[0]!.className).toContain("break-words");
    expect(items[0]!.className).toContain("min-w-0");
  });
});
