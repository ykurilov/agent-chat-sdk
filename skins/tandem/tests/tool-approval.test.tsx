// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemToolCallRow } from "../src/tool-call-row";

afterEach(cleanup);

type Props = Parameters<typeof TandemToolCallRow>[0];

const renderRow = (props: Partial<Props>) =>
  render(<TandemToolCallRow toolName="delete_notes" state="running" open={false} onOpenChange={vi.fn()} {...props} />);

const requested = (overrides: Partial<Extract<NonNullable<Props["approval"]>, { state: "requested" }>> = {}) =>
  ({ state: "requested", onDecide: vi.fn(), pending: false, failed: false, canAlways: true, ...overrides }) as const;

describe("карточка подтверждения", () => {
  it("название по-человечески, входные данные читаемо, три кнопки", () => {
    renderRow({ title: "Удалить заметки", input: { folder: "старое", limit: 10, dryRun: false }, approval: requested() });
    expect(screen.getByText("Агент хочет: Удалить заметки")).toBeTruthy();
    expect(screen.getByText("folder")).toBeTruthy();
    expect(screen.getByText("старое")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("false")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Разрешить" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отклонить" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Всегда в этом чате" })).toBeTruthy();
  });

  it("без названия используется имя инструмента; вложенные данные показываются как есть", () => {
    renderRow({ input: { filter: { tag: "старое" } }, approval: requested() });
    expect(screen.getByText("Агент хочет: delete_notes")).toBeTruthy();
    expect(screen.getByText(/"tag": "старое"/)).toBeTruthy();
  });

  it("кнопки отдают решение", () => {
    const onDecide = vi.fn();
    renderRow({ approval: requested({ onDecide }) });
    fireEvent.click(screen.getByRole("button", { name: "Разрешить" }));
    fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    fireEvent.click(screen.getByRole("button", { name: "Всегда в этом чате" }));
    expect(onDecide.mock.calls.map(([decision]) => decision)).toEqual(["allow", "deny", "always"]);
  });

  it("пока ответ уходит на сервер, кнопки заняты", () => {
    renderRow({ approval: requested({ pending: true }) });
    for (const name of ["Разрешить", "Отклонить", "Всегда в этом чате"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("если ответ не дошёл, пометка об этом и кнопки снова доступны", () => {
    renderRow({ approval: requested({ failed: true }) });
    expect(screen.getByRole("alert").textContent).toBe("Ответ не дошёл до сервера, попробуйте ещё раз");
    expect((screen.getByRole("button", { name: "Разрешить" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("«Всегда в этом чате» нет, если сервер её не предложил", () => {
    renderRow({ approval: requested({ canAlways: false }) });
    expect(screen.queryByRole("button", { name: "Всегда в этом чате" })).toBeNull();
    expect(screen.getByRole("button", { name: "Разрешить" })).toBeTruthy();
  });

  it("причина отказа показывается своим текстом", () => {
    renderRow({ approval: requested({ failed: true, failureText: "Лимит расходов исчерпан, ответить сейчас нельзя" }) });
    expect(screen.getByRole("alert").textContent).toBe("Лимит расходов исчерпан, ответить сейчас нельзя");
  });

  it("карточка — группа с названием действия", () => {
    renderRow({ title: "Удалить заметки", approval: requested() });
    const group = screen.getByRole("group", { name: "Агент хочет: Удалить заметки" });
    expect(within(group).getByRole("button", { name: "Разрешить" })).toBeTruthy();
  });

  it("«Ждёт вашего решения» лежит в области aria-live, которая есть и до ожидания", () => {
    const { container, rerender } = renderRow({ approval: requested() });
    const live = container.querySelector('[data-approval-waiting][aria-live="polite"]')!;
    expect(live).toBeTruthy();
    expect(live.textContent).toBe("");
    rerender(<TandemToolCallRow toolName="delete_notes" state="running" open={false} onOpenChange={vi.fn()} approval={requested({ pending: true })} />);
    expect(container.querySelector('[data-approval-waiting][aria-live="polite"]')!.textContent).toBe("Ждёт вашего решения");
  });

  it("нажатие кнопки не теряет фокус: он переходит на карточку, а после итога — на строку вызова", () => {
    const onDecide = vi.fn();
    const { rerender } = renderRow({ title: "Удалить заметки", approval: requested({ onDecide }) });
    const allow = screen.getByRole("button", { name: "Разрешить" });
    allow.focus();
    fireEvent.click(allow);
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Агент хочет: Удалить заметки" }));
    rerender(<TandemToolCallRow toolName="delete_notes" title="Удалить заметки" state="running" open={false} onOpenChange={vi.fn()} approval={requested({ onDecide, pending: true })} />);
    // Кнопки заняты, но фокус остался на карточке.
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Агент хочет: Удалить заметки" }));
    rerender(<TandemToolCallRow toolName="delete_notes" state="done" open={false} onOpenChange={vi.fn()} approval={{ state: "allowed" }} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Delete_notes|delete_notes|выполнен/i }));
  });

  it("итог решения озвучивается областью, которая была на странице до итога", () => {
    const { container, rerender } = renderRow({ approval: requested() });
    const before = container.querySelector('[data-approval-outcome][aria-live="polite"]')!;
    expect(before).toBeTruthy();
    expect(before.textContent).toBe("");
    rerender(<TandemToolCallRow toolName="delete_notes" state="done" open={false} onOpenChange={vi.fn()} approval={{ state: "denied" }} />);
    const after = container.querySelector('[data-approval-outcome][aria-live="polite"]')!;
    expect(after).toBe(before);
    expect(after.textContent).toBe("Отклонено");
  });

  it("длинное имя поля и длинный вход не выпирают: колонки сжимаются, вход прокручивается", () => {
    const { container } = renderRow({ input: { [`очень_длинное_имя_поля_${"x".repeat(80)}`]: "значение".repeat(50) }, approval: requested() });
    const scroller = container.querySelector("[data-approval-input]")!;
    expect(scroller.className).toMatch(/overflow-y-auto/);
    expect(scroller.className).toMatch(/max-h-/);
    const dl = container.querySelector("dl")!;
    expect(dl.className).toMatch(/minmax\(0,/);
    expect(container.querySelector("dt")!.className).toMatch(/break-words|break-all/);
  });

  it("карточка не превращается в обычную строку вызова", () => {
    renderRow({ approval: requested() });
    expect(screen.queryByRole("button", { name: /выполняется/ })).toBeNull();
  });
});

describe("итог решения в строке вызова", () => {
  it.each([
    ["allowed", "Разрешено"],
    ["always", "Разрешено в этом чате"],
    ["denied", "Отклонено"],
  ] as const)("%s: пометка «%s», кнопок нет", (state, mark) => {
    renderRow({ state: state === "denied" ? "error" : "done", approval: { state } });
    // Один раз для глаз (в строке) и один раз для читалки (невидимая область с итогом).
    expect(screen.getAllByText(mark)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Разрешить" })).toBeNull();
  });

  it("вызов без подтверждения без пометок", () => {
    renderRow({ state: "done" });
    expect(screen.queryByText("Разрешено")).toBeNull();
  });
});
