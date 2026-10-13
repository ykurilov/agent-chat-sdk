// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import { russianLabels } from "@ykurilov/agent-chat-react";
import type { VoiceDialogError, VoiceDialogState, VoiceDialogView } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer } from "../src/composer";
import { TandemVoiceDialogPanel } from "../src/voice-dialog-panel";

afterEach(cleanup);

const words = russianLabels.voiceDialog;

const dialogView = (override: Partial<VoiceDialogView> = {}): VoiceDialogView => ({
  state: "listening",
  speechAvailable: true,
  onToggle: vi.fn(),
  ...override,
});

function renderPanel(dialog: VoiceDialogView) {
  return render(
    <TooltipProvider>
      <TandemVoiceDialogPanel dialog={dialog} />
    </TooltipProvider>,
  );
}

describe("панель голосового режима Тандема", () => {
  const states: Exclude<VoiceDialogState, "off">[] = ["connecting", "listening", "thinking", "speaking", "interrupted", "error"];
  it.each(states)("состояние %s сказано словами в живой области", (state) => {
    renderPanel(dialogView({ state }));

    expect(screen.getByRole("status").textContent).toContain(words.states[state]);
  });

  it("кнопка «Выйти» зовёт onToggle", () => {
    const dialog = dialogView();
    renderPanel(dialog);

    fireEvent.click(screen.getByRole("button", { name: words.exit }));

    expect(dialog.onToggle).toHaveBeenCalledOnce();
  });

  it("кнопка выхода не меньше 44 пунктов", () => {
    renderPanel(dialogView());

    const exit = screen.getByRole("button", { name: words.exit });
    expect(exit.style.minWidth).toBe("44px");
    expect(exit.style.minHeight).toBe("44px");
  });

  describe("индикатор уровня", () => {
    const indicator = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-level]")!;

    it("пока слушаем, повторяет громкость микрофона", () => {
      const { container } = renderPanel(dialogView({ state: "listening", level: 0.6 }));

      expect(indicator(container).dataset.level).toBe("0.6");
    });

    it("громкость вне 0..1 обрезается, её отсутствие — тишина", () => {
      const { container, rerender } = renderPanel(dialogView({ level: 3 }));
      expect(indicator(container).dataset.level).toBe("1");

      rerender(
        <TooltipProvider>
          <TandemVoiceDialogPanel dialog={dialogView({ level: -2 })} />
        </TooltipProvider>,
      );
      expect(indicator(container).dataset.level).toBe("0");

      rerender(
        <TooltipProvider>
          <TandemVoiceDialogPanel dialog={dialogView({})} />
        </TooltipProvider>,
      );
      expect(indicator(container).dataset.level).toBe("0");
    });

    it("не для экранного диктора: состояние уже сказано словами", () => {
      const { container } = renderPanel(dialogView({ level: 0.5 }));

      expect(indicator(container).closest("[aria-hidden=true]")).not.toBeNull();
    });

    it("когда не слушаем, микрофон не показывается громким: думаем и говорим — уровень 0", () => {
      const { container } = renderPanel(dialogView({ state: "speaking", level: 0.9 }));

      expect(indicator(container).dataset.level).toBe("0");
    });
  });

  describe("ошибки", () => {
    const errors = Object.keys(words.errors) as VoiceDialogError[];
    it.each(errors)("%s: надпись из словаря, объявляется сразу", (error) => {
      renderPanel(dialogView({ state: "error", error }));

      expect(screen.getByRole("alert").textContent).toBe(words.errors[error]);
    });

    it("без ошибки надписи об ошибке нет", () => {
      renderPanel(dialogView());

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("озвучки нет, но режим работает: тихая надпись «ответы приходят текстом», не тревога", () => {
      renderPanel(dialogView({ speechAvailable: false }));

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText(words.errors.speech_unavailable)).toBeTruthy();
    });

    it("есть ошибка — пометка «ответы приходят текстом» не добавляется: режим и так остановлен", () => {
      renderPanel(dialogView({ state: "error", speechAvailable: false, error: "network" }));

      expect(screen.queryByText(words.errors.speech_unavailable)).toBeNull();
    });

    it("озвучка недоступна как ошибка: надпись одна, не двойная", () => {
      renderPanel(dialogView({ speechAvailable: false, error: "speech_unavailable" }));

      expect(screen.getAllByText(words.errors.speech_unavailable)).toHaveLength(1);
    });

    it("режим выключили по простою: причина видна вместе с состоянием «выключен»", () => {
      renderPanel(dialogView({ state: "off", error: "idle" }));

      expect(screen.getByRole("alert").textContent).toBe(words.errors.idle);
    });
  });

  it("меню голосов внутри панели, если голосов больше одного", () => {
    renderPanel(dialogView({ voices: [{ id: "a", name: "Анна" }, { id: "b", name: "Борис" }], currentVoiceId: "a", onSelectVoice: vi.fn() }));

    expect(screen.getByRole("button", { name: `${words.voiceMenu}: Анна` })).toBeTruthy();
  });

  it("голос один — меню в панели нет", () => {
    renderPanel(dialogView({ voices: [{ id: "a", name: "Анна" }], currentVoiceId: "a", onSelectVoice: vi.fn() }));

    expect(screen.queryByRole("button", { name: /Голос/ })).toBeNull();
  });
});

describe("поле ввода Тандема: панель режима", () => {
  const renderComposer = (dialog?: VoiceDialogView) =>
    render(
      <TooltipProvider>
        <TandemComposer value="черновик" onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit onStop={vi.fn()} busy={false} {...(dialog && { dialog })} />
      </TooltipProvider>,
    );

  it("режим выключен: поле ввода на месте, панели нет", () => {
    renderComposer(dialogView({ state: "off" }));

    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: words.exit })).toBeNull();
  });

  it("режим включён: панель на месте, поле ввода скрыто (клавиатура не вызывается), отправить недоступно", () => {
    renderComposer(dialogView({ state: "listening" }));

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
    expect(within(screen.getByRole("status")).getByText(words.states.listening)).toBeTruthy();
    expect(screen.getByRole("button", { name: words.exit })).toBeTruthy();
  });

  it("выход из режима возвращает поле, черновик на месте", () => {
    const { rerender } = renderComposer(dialogView({ state: "listening" }));

    rerender(
      <TooltipProvider>
        <TandemComposer value="черновик" onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit busy={false} onStop={vi.fn()} dialog={dialogView({ state: "off" })} />
      </TooltipProvider>,
    );

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("черновик");
  });

  it("причина выключения (простой) видна и после выхода, пока поле уже вернулось", () => {
    renderComposer(dialogView({ state: "off", error: "idle" }));

    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(words.errors.idle);
  });

  it("пока идёт ответ, кнопка «Стоп» остаётся доступной в режиме", () => {
    render(
      <TooltipProvider>
        <TandemComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit={false} busy onStop={vi.fn()} dialog={dialogView({ state: "speaking" })} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: russianLabels.stop })).toBeTruthy();
  });
});
