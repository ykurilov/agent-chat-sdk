// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemHelperCallRow } from "../src/helper-call-row";

afterEach(cleanup);

type Props = Parameters<typeof TandemHelperCallRow>[0];

const renderRow = (props: Partial<Props> = {}) =>
  render(
    <TandemHelperCallRow
      name="researcher"
      task="Найди три статьи про сон"
      steps={[
        { kind: "tool", id: "0", toolName: "web_search", state: "done", input: { query: "сон" } },
        { kind: "tool", id: "1", toolName: "fetch_page", state: "error", errorText: "timeout" },
        { kind: "text", id: "2", text: "Нашёл две статьи" },
      ]}
      text="Вот две статьи"
      status="done"
      open={false}
      onOpenChange={vi.fn()}
      {...props}
    />,
  );

describe("строка помощника Тандема", () => {
  it("свёрнутая: имя помощника, статус словами и задание одной строкой; шагов не видно", () => {
    renderRow();
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.textContent).toContain("researcher");
    expect(toggle.textContent).toContain("Готово");
    expect(toggle.textContent).toContain("Найди три статьи про сон");
    expect(screen.queryByText("web_search")).toBeNull();
  });

  it("человеческое название вместо имени", () => {
    renderRow({ title: "Исследователь" });
    expect(screen.getByRole("button", { expanded: false }).textContent).toContain("Исследователь");
  });

  it("нажатие раскрывает строку", () => {
    const onOpenChange = vi.fn();
    renderRow({ onOpenChange });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("раскрытая: «Поручено», шаги с состоянием, «Вернул» с итогом", () => {
    renderRow({ open: true });
    expect(screen.getByText("Поручено")).toBeTruthy();
    expect(screen.getByText("web_search")).toBeTruthy();
    expect(screen.getByText("fetch_page")).toBeTruthy();
    expect(screen.getByText("timeout")).toBeTruthy();
    expect(screen.getByText("Нашёл две статьи")).toBeTruthy();
    expect(screen.getByText("Вернул")).toBeTruthy();
    expect(screen.getByText("Вот две статьи")).toBeTruthy();
  });

  it("каждый статус подписан словами из словаря", () => {
    for (const [status, text] of [
      ["running", "Работает…"],
      ["awaiting_approval", "Ждёт подтверждения"],
      ["failed", "Не получилось"],
      ["background", "Работает в фоне"],
    ] as const) {
      const { unmount } = renderRow({ status });
      expect(screen.getByRole("button", { expanded: false }).textContent).toContain(text);
      unmount();
    }
  });

  it("сбой: текст ошибки в раскрытой строке", () => {
    renderRow({ status: "failed", errorText: "модель недоступна", open: true, text: "" });
    expect(screen.getByText("модель недоступна")).toBeTruthy();
    expect(screen.queryByText("Вернул")).toBeNull();
  });

  it("подтверждение внутри помощника — готовая карточка «Разрешить / Отклонить» без «всегда»", () => {
    const onDecide = vi.fn();
    renderRow({
      status: "awaiting_approval",
      approval: { state: "requested", onDecide, pending: false, failed: false, canAlways: false },
      approvalAction: { toolName: "delete_notes", title: "Удалить заметки", input: { ids: "1, 2" } },
    });
    expect(screen.getByText("Агент хочет: Удалить заметки")).toBeTruthy();
    expect(screen.getByText("1, 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Всегда в этом чате" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Разрешить" }));
    expect(onDecide).toHaveBeenCalledWith("allow");
  });

  it("у действия нет названия — карточка называет инструмент", () => {
    renderRow({
      status: "awaiting_approval",
      approval: { state: "requested", onDecide: vi.fn(), pending: false, failed: false, canAlways: false },
      approvalAction: { toolName: "delete_notes" },
    });
    expect(screen.getByText("Агент хочет: delete_notes")).toBeTruthy();
  });

  it("решение уже принято — отметка в строке", () => {
    renderRow({ status: "running", approval: { state: "denied" } });
    expect(screen.getByRole("button", { expanded: false }).textContent).toContain("Отклонено");
  });
});
