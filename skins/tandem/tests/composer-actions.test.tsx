// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, TooltipProvider } from "@tandem/ui";
import type { VoiceDialogView, VoiceInputView } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer } from "../src/composer";

afterEach(cleanup);

const onCheck = vi.fn();
const check = (
  <button type="button" onClick={onCheck}>
    Проверить работу
  </button>
);

function renderComposer(props: Partial<ComponentProps<typeof TandemComposer>> = {}) {
  return render(
    <TooltipProvider>
      <TandemComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

const dictation = (): VoiceInputView => ({ state: "idle", onToggle: vi.fn() });
const dialogView = (state: VoiceDialogView["state"]): VoiceDialogView => ({ state, speechAvailable: true, onToggle: vi.fn() });

describe("поле ввода Тандема: кнопки приложения (actions)", () => {
  it("без actions своих кнопок нет", () => {
    renderComposer();
    expect(screen.queryByRole("button", { name: "Проверить работу" })).toBeNull();
  });

  it("кнопка приложения стоит в поле, нажатие доходит до приложения", () => {
    onCheck.mockClear();
    renderComposer({ actions: check });
    fireEvent.click(screen.getByRole("button", { name: "Проверить работу" }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("с кнопками голоса: и голос, и кнопка приложения на месте", () => {
    renderComposer({ actions: check, voice: dictation(), dialog: dialogView("off") });
    expect(screen.getByRole("button", { name: "Проверить работу" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Диктовать" })).toBeTruthy();
  });

  it("в голосовом режиме поле скрыто, а кнопка приложения остаётся видимой", () => {
    renderComposer({ actions: check, dialog: dialogView("listening") });
    const button = screen.getByRole("button", { name: "Проверить работу" });
    expect(button.closest("[hidden]")).toBeNull();
    expect(button.closest(".hidden")).toBeNull();
  });

  it("кнопка приложения есть ровно одна в любом режиме", () => {
    renderComposer({ actions: check, dialog: dialogView("listening") });
    expect(screen.getAllByRole("button", { name: "Проверить работу" })).toHaveLength(1);
  });
});

describe("поле ввода Тандема: кнопка-значок в actions", () => {
  it("прижатие к левому краю не достаётся кнопке-значку, а широкому элементу достаётся", () => {
    renderComposer({
      actions: (
        <>
          <Button size="icon" aria-label="Значок">
            +
          </Button>
          <button type="button">Длинная подпись выбора</button>
        </>
      ),
    });
    const icon = screen.getByRole("button", { name: "Значок" });
    const wide = screen.getByRole("button", { name: "Длинная подпись выбора" });
    const row = icon.parentElement as HTMLElement;
    // Правило ряда: justify-start только для детей без класса size-… (то есть не для значков).
    expect(row.className).not.toMatch(/\[&>\*\]:justify-start/);
    const exclusion = ":not([class*=size-])";
    expect(row.className).toContain(`[&>*${exclusion}]:justify-start`);
    expect(icon.matches(exclusion)).toBe(false);
    expect(wide.matches(exclusion)).toBe(true);
  });
});
