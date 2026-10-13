// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer } from "../src/composer";
import { TandemUserMessage } from "../src/user-message";

afterEach(cleanup);

function renderComposer(props: Partial<ComponentProps<typeof TandemComposer>> = {}) {
  return render(
    <TooltipProvider>
      <TandemComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

describe("Тандем: поправка на лету", () => {
  it("идёт ответ, поле принимает поправки — «Отправить» и «Стоп» рядом в рамке поля", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    renderComposer({ value: "Сделай синей", busy: true, canSteer: true, onSubmit, onStop });
    const send = screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    const frame = send.closest("div.rounded-\\[16px\\]");
    expect(frame?.contains(screen.getByRole("button", { name: "Остановить" }))).toBe(true);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("без canSteer (скин версии 20 или steering={false}) — как раньше: в рамке только «Стоп»", () => {
    renderComposer({ value: "Сделай синей", busy: true });
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Остановить" })).toHaveLength(1);
  });

  it("поправка, которую агент ещё не взял, — с пометкой; взятая — без", () => {
    const { rerender } = render(<TandemUserMessage text="Сделай синей" pending />);
    expect(screen.getByText("Агент учтёт на следующем шаге")).toBeTruthy();
    rerender(<TandemUserMessage text="Сделай синей" />);
    expect(screen.queryByText("Агент учтёт на следующем шаге")).toBeNull();
  });
});
