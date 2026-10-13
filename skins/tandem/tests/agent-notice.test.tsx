// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemAgentNotice } from "../src/agent-notice";

afterEach(cleanup);

describe("плашка служебного сообщения Тандема", () => {
  it("готовая задача: что случилось, название и итог текстом", () => {
    render(<TandemAgentNotice kind="task_done" title="Отчёт по сделкам" result={"Три сделки\n**не разметка**"} />);
    const plaque = screen.getByRole("note");
    expect(plaque.textContent).toContain("Задача готова");
    expect(plaque.textContent).toContain("Отчёт по сделкам");
    expect(plaque.textContent).toContain("**не разметка**");
    expect(plaque.querySelector("strong")).toBeNull();
  });

  it("сбой — текст ошибки", () => {
    render(<TandemAgentNotice kind="task_failed" title="Сводка" errorText="модель недоступна" />);
    expect(screen.getByRole("note").textContent).toContain("Задача не удалась");
    expect(screen.getByText("модель недоступна")).toBeTruthy();
  });

  it("отменённая и «разговор начат» — подписи из словаря", () => {
    const { unmount } = render(<TandemAgentNotice kind="task_canceled" title="Отчёт" />);
    expect(screen.getByRole("note").textContent).toContain("Задача отменена");
    unmount();
    render(<TandemAgentNotice kind="conversation_started" title="" />);
    expect(screen.getByRole("note").textContent).toContain("Агент написал первым");
  });

  it("ждёт подтверждения: карточка «Разрешить / Отклонить» без «всегда»", () => {
    const onDecide = vi.fn();
    render(
      <TandemAgentNotice
        kind="task_awaiting_approval"
        title="Чистка заметок"
        approval={{ state: "requested", onDecide, pending: false, failed: false, canAlways: false }}
      />,
    );
    expect(screen.getByText("Агент хочет: Чистка заметок")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Всегда в этом чате" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    expect(onDecide).toHaveBeenCalledWith("deny");
  });

  it("решение принято — отметка вместо кнопок", () => {
    render(<TandemAgentNotice kind="task_awaiting_approval" title="Чистка заметок" approval={{ state: "allowed" }} />);
    expect(screen.getByRole("note").textContent).toContain("Разрешено");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
