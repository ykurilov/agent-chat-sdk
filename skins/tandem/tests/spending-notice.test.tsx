// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { tandemSkin } from "../src";
import { TandemSpendingNotice } from "../src/spending-notice";

afterEach(cleanup);

describe("надпись о лимите расходов", () => {
  it("предупреждение: текст из слоя поведения, роль status, состояние в атрибуте", () => {
    render(<TandemSpendingNotice id="n" state="warning" text="Использовано 80% лимита на месяц" />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Использовано 80% лимита на месяц");
    expect(notice.getAttribute("data-spending-state")).toBe("warning");
  });

  it("исчерпание: отдельное состояние, тот же текст без своих слов", () => {
    render(<TandemSpendingNotice id="n" state="exhausted" text="Лимит на месяц исчерпан, обновится 1 ноября" />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Лимит на месяц исчерпан, обновится 1 ноября");
    expect(notice.getAttribute("data-spending-state")).toBe("exhausted");
  });

  it("нет причины: область для диктора на месте и пуста; id и фокусируемость заданы, вид не занимает места", () => {
    render(<TandemSpendingNotice id="spending-1" state="none" text="" />);
    const region = screen.getByRole("status");
    expect(region.id).toBe("spending-1");
    expect(region.textContent).toBe("");
    expect(region.tabIndex).toBe(-1);
    expect(region.hasAttribute("data-spending-empty")).toBe(true);
  });

  it("с причиной область та же (тот же id), пустой отметки нет, внутри нет второго role=status", () => {
    const { rerender } = render(<TandemSpendingNotice id="spending-1" state="none" text="" />);
    const before = screen.getByRole("status");
    rerender(<TandemSpendingNotice id="spending-1" state="exhausted" text="Лимит исчерпан" />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toBe(before);
    expect(before.hasAttribute("data-spending-empty")).toBe(false);
    expect(before.textContent).toContain("Лимит исчерпан");
  });

  it("скин Тандема отдаёт компонент договора версии 8", () => {
    expect(tandemSkin.SpendingNotice).toBe(TandemSpendingNotice);
  });
});
