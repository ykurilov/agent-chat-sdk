// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemSkin } from "../src";
import { TandemWorkSteps, visibleStepIcons } from "../src/work-steps";

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

describe("значки шагов и заголовки раздумий в Тандеме (договор 28)", () => {
  const items = [
    { icon: "thinking", phrase: "Продумываю правила игры", failed: false },
    { icon: "edit", phrase: "Правил src/rules.ts", failed: false },
    { icon: "my-own-kind", phrase: "Свой шаг", failed: false },
  ];

  it("свёрнутая строка: ряд значков рядом с «Сделано N шагов» и «+N», диктору — только подпись", () => {
    const { container } = render(
      <TandemWorkSteps state="done" steps={steps} count={12} items={items} icons={["thinking", "edit", "skill"]} moreIcons={9} open={false} onOpenChange={vi.fn()} />,
    );
    const row = container.querySelector("[data-step-icons]")!;
    expect([...row.querySelectorAll("[data-step-icon]")].map((icon) => icon.getAttribute("data-step-icon"))).toEqual(["thinking", "edit", "skill"]);
    expect(row.getAttribute("aria-hidden")).toBe("true");
    expect(row.textContent).toContain("+9");
    expect(screen.getByRole("button").textContent).toContain("Сделано 12 шагов");
  });

  it("раскрытый список по items: значок и фраза, незнакомый вид — общий значок", () => {
    const { container } = render(<TandemWorkSteps state="done" steps={steps} count={2} items={items} icons={[]} moreIcons={0} open onOpenChange={vi.fn()} />);
    const rows = [...container.querySelectorAll("[data-work-step]")];
    expect(rows.map((row) => row.textContent)).toEqual(["Продумываю правила игры", "Правил src/rules.ts", "Свой шаг"]);
    expect(rows.map((row) => row.querySelector("[data-step-icon]")?.getAttribute("data-step-icon"))).toEqual(["thinking", "edit", "tool"]);
  });

  it("живая строка со значком вместо точки", () => {
    const { container } = render(<TandemWorkSteps state="live" phrase="Правлю src/rules.ts…" icon="edit" />);
    expect(container.querySelector("[data-work-live] [data-step-icon]")?.getAttribute("data-step-icon")).toBe("edit");
  });

  it("без новых полей (AgentChat старше 0.69) — как раньше", () => {
    const { container } = render(<TandemWorkSteps state="done" steps={steps} count={3} open onOpenChange={vi.fn()} />);
    expect(container.querySelector("[data-step-icons]")).toBeNull();
    expect([...container.querySelectorAll("[data-work-step]")].map((row) => row.textContent)).toEqual(steps.map((step) => step.phrase));
  });
});

describe("ряд значков по ширине (0.69.1)", () => {
  // Значок 14 px, промежуток 4 px; «+N» — по 7 px на знак.
  const plus = (hidden: number) => `+${hidden}`.length * 7;

  it("всё помещается — все значки, без «+N»", () => {
    expect(visibleStepIcons(200, 5, plus)).toBe(5);
  });

  it("не помещается — меньше значков, «+N» всегда влезает", () => {
    // 3 значка (50 px) + промежуток + «+9» (14 px) = 68 ≤ 70; 4 значка уже 72 + 4 + 14 > 70.
    expect(visibleStepIcons(70, 12, plus)).toBe(3);
    expect(visibleStepIcons(25, 12, plus)).toBe(0);
    // Значки 16 px (кнопка Тандема): 3 значка уже 56 + 4 + 14 > 70.
    expect(visibleStepIcons(70, 12, plus, 16)).toBe(2);
  });

  it("не влезает и одно «+N» — ряда нет (null): число шагов и так в подписи", () => {
    expect(visibleStepIcons(13, 21, plus)).toBeNull();
  });

  it("узкая колонка: ряд не шире места, сколько скрыто — честно", () => {
    for (const width of [10, 40, 90, 136]) {
      const total = 15;
      const shown = visibleStepIcons(width, total, plus) ?? 0;
      const used = shown * 14 + Math.max(0, shown - 1) * 4 + (shown < total ? (shown > 0 ? 4 : 0) + plus(total - shown) : 0);
      expect(used <= width || shown === 0).toBe(true);
    }
  });
});
