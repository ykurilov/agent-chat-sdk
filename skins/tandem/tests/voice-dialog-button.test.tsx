// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import { russianLabels } from "@ykurilov/agent-chat-react";
import type { VoiceDialogState, VoiceDialogView, VoiceInputView } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer } from "../src/composer";
import { TandemVoiceDialogButton } from "../src/voice-dialog-button";

afterEach(cleanup);

const words = russianLabels.voiceDialog;

const dialogView = (override: Partial<VoiceDialogView> = {}): VoiceDialogView => ({
  state: "off",
  speechAvailable: true,
  onToggle: vi.fn(),
  ...override,
});

const dictation = (): VoiceInputView => ({ state: "idle", onToggle: vi.fn() });

function renderButton(dialog: VoiceDialogView) {
  return render(
    <TooltipProvider>
      <TandemVoiceDialogButton dialog={dialog} />
    </TooltipProvider>,
  );
}

function renderComposer(props: { dialog?: VoiceDialogView; voice?: VoiceInputView }) {
  return render(
    <TooltipProvider>
      <TandemComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit={false} busy={false} onStop={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

describe("кнопка голосового режима Тандема", () => {
  it("выключенный режим: кнопка «Голосовой режим», не нажата; нажатие зовёт onToggle", () => {
    const dialog = dialogView();
    renderButton(dialog);

    const button = screen.getByRole("button", { name: words.start });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(dialog.onToggle).toHaveBeenCalledOnce();
  });

  const active: VoiceDialogState[] = ["connecting", "listening", "thinking", "speaking", "interrupted", "error"];
  it.each(active)("состояние %s: кнопка нажата, в подписи состояние словами и «Выйти»", (state) => {
    const dialog = dialogView({ state });
    renderButton(dialog);

    const button = screen.getByRole("button", { name: `${words.states[state]}. ${words.exit}` });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(dialog.onToggle).toHaveBeenCalledOnce();
  });

  it("кнопка не меньше 44 пунктов", () => {
    renderButton(dialogView());

    const button = screen.getByRole("button", { name: words.start });
    expect(button.style.minWidth).toBe("44px");
    expect(button.style.minHeight).toBe("44px");
  });
});

describe("поле ввода Тандема: кнопка режима", () => {
  it("без dialog кнопки режима нет: приложение без режима выглядит как раньше", () => {
    renderComposer({ voice: dictation() });

    expect(screen.queryByRole("button", { name: words.start })).toBeNull();
  });

  it("рядом с диктовкой, в том же ряду кнопок рамки, и отличается от неё", () => {
    renderComposer({ voice: dictation(), dialog: dialogView() });

    const mic = screen.getByRole("button", { name: "Диктовать" });
    const mode = screen.getByRole("button", { name: words.start });
    expect(mode).not.toBe(mic);
    expect(mode.parentElement).toBe(mic.parentElement);
    expect(screen.getByRole("textbox").parentElement!.contains(mode)).toBe(true);
    expect(mode.compareDocumentPosition(screen.getByRole("button", { name: "Отправить" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("режим есть, диктовки нет: кнопка режима всё равно стоит в поле", () => {
    renderComposer({ dialog: dialogView() });

    expect(screen.getByRole("button", { name: words.start })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Диктовать" })).toBeNull();
  });
});
