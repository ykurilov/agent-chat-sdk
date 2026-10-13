// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemTaskCard } from "../src/task-card";

afterEach(cleanup);

type Props = Parameters<typeof TandemTaskCard>[0];
const renderCard = (props: Partial<Props> = {}) =>
  render(<TandemTaskCard id="t1" title="Отчёт по сделкам" status="running" elapsedMs={65_000} onCancel={vi.fn()} {...props} />);

describe("карточка фоновой задачи Тандема", () => {
  it("название, статус словами и «сколько идёт»", () => {
    renderCard();
    const card = screen.getByRole("group", { name: "Отчёт по сделкам" });
    expect(card.textContent).toContain("Идёт");
    expect(card.textContent).toContain("идёт 1 мин");
  });

  it("у законченной задачи — сколько она заняла, а не «идёт»", () => {
    renderCard({ status: "done", onCancel: undefined });
    const card = screen.getByRole("group", { name: "Отчёт по сделкам" });
    expect(card.textContent).toContain("заняла 1 мин");
    expect(card.textContent).not.toContain("идёт");
  });

  it("каждый статус подписан словами из словаря", () => {
    for (const [status, text] of [
      ["queued", "В очереди"],
      ["awaiting_approval", "Ждёт подтверждения"],
      ["done", "Готово"],
      ["failed", "Ошибка"],
      ["canceled", "Отменена"],
      ["interrupted", "Прервана"],
      ["timed_out", "Не уложилась во время"],
    ] as const) {
      const { unmount } = renderCard({ status });
      expect(screen.getByRole("group").textContent).toContain(text);
      unmount();
    }
  });

  it("«Отменить» зовёт onCancel; пока отмена идёт — кнопка занята и подписана «Отменяем…»", () => {
    const onCancel = vi.fn();
    const { rerender } = renderCard({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<TandemTaskCard id="t1" title="Отчёт по сделкам" status="running" elapsedMs={65_000} onCancel={onCancel} canceling />);
    const busy = screen.getByRole("button", { name: "Отменяем…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
  });

  it("без onCancel кнопки нет", () => {
    render(<TandemTaskCard id="t1" title="Отчёт" status="done" elapsedMs={1000} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
